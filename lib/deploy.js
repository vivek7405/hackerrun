import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { Config } from './config.js';
import { ComposeManager } from './compose.js';
import { DockerContext } from './docker-context.js';
import { SSHClient } from './ssh.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function deployCommand() {
  console.log(chalk.blue.bold('🚀 HackerRun Deploy'));
  console.log(chalk.gray('Deploying your app to VPS with Traefik...\n'));

  // Check if VPS is configured
  const vpsIp = Config.getVpsIp();
  if (!vpsIp) {
    console.error(chalk.red('❌ VPS not configured. Run'), chalk.cyan('hackerrun init'), chalk.red('first.'));
    process.exit(1);
  }

  // Check if docker-compose.yml exists
  const composeFilePath = path.join(process.cwd(), 'docker-compose.yml');
  if (!fs.existsSync(composeFilePath)) {
    console.error(chalk.red('❌ docker-compose.yml not found in current directory'));
    process.exit(1);
  }

  console.log(chalk.green('✅ Found docker-compose.yml'));

  // Parse compose file
  let composeData;
  try {
    composeData = ComposeManager.parseCompose(composeFilePath);
  } catch (error) {
    console.error(chalk.red('❌ Failed to parse docker-compose.yml:'), error.message);
    process.exit(1);
  }

  // Handle .env file detection and selection
  const selectedEnvFile = await handleEnvFile();

  // Get available services
  const services = ComposeManager.getServices(composeData);
  console.log(chalk.blue('📦 Found services:'), services.join(', '));

  // Ask user which service to expose
  const { selectedService } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedService',
      message: 'Which service do you want to expose to the internet?',
      choices: services
    }
  ]);

  // Ask for custom port if needed
  const { customPort } = await inquirer.prompt([
    {
      type: 'input',
      name: 'customPort',
      message: `What port does ${selectedService} run on?`,
      default: '80',
      validate: (input) => {
        const port = parseInt(input);
        if (isNaN(port) || port < 1 || port > 65535) {
          return 'Please enter a valid port number (1-65535)';
        }
        return true;
      }
    }
  ]);

  // Ask for email for Let's Encrypt
  const { email } = await inquirer.prompt([
    {
      type: 'input',
      name: 'email',
      message: 'Enter your email for Let\'s Encrypt SSL certificate:',
      validate: (input) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(input)) {
          return 'Please enter a valid email address';
        }
        return true;
      }
    }
  ]);

  // Generate domain
  const domain = `${selectedService}.${vpsIp}.sslip.io`;
  console.log(chalk.yellow('🌐 Your app will be available at:'), chalk.cyan(`https://${domain}`));

  // Create modified compose file
  const spinner = ora('Creating deployment configuration...').start();
  
  try {
    // Clone the original compose data
    const hackerrunComposeData = JSON.parse(JSON.stringify(composeData));
    
    // Add Traefik labels to selected service
    ComposeManager.addTraefikLabels(hackerrunComposeData, selectedService, domain);
    
    // Update the port in Traefik labels if not default
    if (customPort !== '80') {
      const service = hackerrunComposeData.services[selectedService];
      const portLabelIndex = service.labels.findIndex(label => 
        label.includes('loadbalancer.server.port=')
      );
      if (portLabelIndex !== -1) {
        service.labels[portLabelIndex] = `traefik.http.services.${selectedService}.loadbalancer.server.port=${customPort}`;
      }
    }
    
    // Add selected .env file if one was chosen
    if (selectedEnvFile) {
      ComposeManager.addEnvFile(hackerrunComposeData, selectedEnvFile);
    }
    
    // Add Traefik network
    ComposeManager.addTraefikNetwork(hackerrunComposeData);
    
    // Save the new compose file
    const hackerrunComposeFilePath = path.join(process.cwd(), 'docker-compose.hackerrun.yml');
    ComposeManager.saveCompose(hackerrunComposeData, hackerrunComposeFilePath);
    
    spinner.succeed('Deployment configuration created');
  } catch (error) {
    spinner.fail('Failed to create deployment configuration');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }

  // Update Traefik configuration with email
  const emailSpinner = ora('Updating Traefik SSL configuration...').start();
  
  try {
    const ssh = new SSHClient(vpsIp);
    await ssh.connect();
    
    // Read current traefik config
    const traefikConfig = await ssh.executeCommand('cat /opt/hackerrun/traefik/traefik.yml || echo ""');
    
    if (traefikConfig.trim() === '') {
      // Create new traefik.yml with provided email
      const traefikYml = `api:
  dashboard: true
  insecure: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: traefik

certificatesResolvers:
  letsencrypt:
    acme:
      email: ${email}
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web

log:
  level: INFO

accessLog: {}`;
      
      await ssh.executeCommand(`cat > /opt/hackerrun/traefik/traefik.yml << 'EOF'
${traefikYml}
EOF`);
      
      // Restart Traefik to pick up new config
      await ssh.executeCommand('cd /opt/hackerrun && docker compose -f docker-compose.traefik.yml restart traefik');
    } else {
      // Update existing config with new email
      await ssh.executeCommand(`sed -i 's/email: .*/email: ${email}/' /opt/hackerrun/traefik/traefik.yml`);
      await ssh.executeCommand('cd /opt/hackerrun && docker compose -f docker-compose.traefik.yml restart traefik');
    }
    
    await ssh.disconnect();
    emailSpinner.succeed('Traefik SSL configuration updated');
  } catch (error) {
    emailSpinner.fail('Failed to update Traefik SSL configuration');
    console.error(chalk.red('Warning:'), error.message);
    console.log(chalk.yellow('SSL certificates may not work properly. Please check Traefik configuration manually.'));
  }

  // Switch to VPS Docker context
  const contextSpinner = ora('Switching to VPS Docker context...').start();
  const contextName = `hackerrun-${vpsIp.replace(/\./g, '-')}`;
  let originalContext;
  
  try {
    // Get current context to switch back later
    originalContext = await DockerContext.getCurrentContext();
    
    // Check if context exists
    const contextExists = await DockerContext.contextExists(contextName);
    if (!contextExists) {
      throw new Error(`Docker context '${contextName}' not found. Run 'hackerrun init' first.`);
    }
    
    // Switch to VPS context
    await DockerContext.useContext(contextName);
    contextSpinner.succeed('Switched to VPS Docker context');
  } catch (error) {
    contextSpinner.fail('Failed to switch Docker context');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }

  // Deploy application using Docker context
  const deploySpinner = ora('Deploying application to VPS...').start();
  
  try {
    // Stop any existing deployment
    try {
      await execAsync('docker compose -f docker-compose.hackerrun.yml down');
    } catch (error) {
      // Ignore errors if no previous deployment exists
    }
    
    // Start the new deployment
    await execAsync('docker compose -f docker-compose.hackerrun.yml up -d');
    
    deploySpinner.succeed('Application deployed successfully');
  } catch (error) {
    deploySpinner.fail('Failed to deploy application');
    console.error(chalk.red('Error:'), error.message);
    
    // Switch back to original context before exiting
    try {
      await DockerContext.useContext(originalContext);
    } catch (contextError) {
      console.error(chalk.red('Warning: Failed to switch back to original Docker context'));
    }
    
    process.exit(1);
  }

  // Switch back to original Docker context
  const restoreSpinner = ora('Restoring original Docker context...').start();
  
  try {
    await DockerContext.useContext(originalContext);
    restoreSpinner.succeed('Restored original Docker context');
  } catch (error) {
    restoreSpinner.fail('Failed to restore original Docker context');
    console.error(chalk.red('Warning:'), error.message);
  }

  // Clean up local files
  // TODO: Temporarily disabled cleanup for inspection
  // try {
  //   fs.unlinkSync(path.join(process.cwd(), 'docker-compose.hackerrun.yml'));
  // } catch (error) {
  //   // Ignore cleanup errors
  // }

  // Save deployment info
  Config.saveProjectConfig({
    vpsIp,
    selectedService,
    domain,
    deployedAt: new Date().toISOString()
  });

  console.log(chalk.green.bold('\n🎉 Deployment completed successfully!'));
  console.log(chalk.gray('Your application is now live at:'));
  console.log(chalk.cyan.bold(`https://${domain}`));
  console.log(chalk.gray('\nNote: SSL certificate may take a few minutes to be issued by Let\'s Encrypt.'));
}

async function handleEnvFile() {
  // Look for available .env files
  const envFiles = fs.readdirSync(process.cwd())
    .filter(file => file.startsWith('.env'))
    .sort();

  if (envFiles.length === 0) {
    // No .env files found, prompt user to create one
    console.log(chalk.yellow('⚠️  No .env files found in the project.'));
    
    const { createEnv } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'createEnv',
        message: 'Would you like to create an empty .env file?',
        default: true
      }
    ]);

    if (createEnv) {
      fs.writeFileSync(path.join(process.cwd(), '.env'), '# Add your environment variables here\n');
      console.log(chalk.green('✅ Created empty .env file'));
      return '.env';
    } else {
      console.log(chalk.gray('ℹ️  Proceeding without .env file'));
      return null;
    }
  } else if (envFiles.length === 1) {
    // Single .env file found
    console.log(chalk.green(`✅ Found .env file: ${envFiles[0]}`));
    return envFiles[0];
  } else {
    // Multiple .env files found, let user choose
    console.log(chalk.yellow(`⚠️  Multiple .env files found: ${envFiles.join(', ')}`));
    
    const choices = [...envFiles, { name: 'None (proceed without .env file)', value: null }];
    
    const { selectedEnvFile } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedEnvFile',
        message: 'Which .env file would you like to use for deployment?',
        choices: choices
      }
    ]);

    if (selectedEnvFile) {
      console.log(chalk.green(`✅ Using .env file: ${selectedEnvFile}`));
    } else {
      console.log(chalk.gray('ℹ️  Proceeding without .env file'));
    }
    
    return selectedEnvFile;
  }
}