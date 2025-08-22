import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { SSHClient } from './ssh.js';
import { Config } from './config.js';
import { ComposeManager } from './compose.js';

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
    
    // Add Traefik service
    ComposeManager.addTraefikService(hackerrunComposeData);
    
    // Save the new compose file
    const hackerrunComposeFilePath = path.join(process.cwd(), 'docker-compose.hackerrun.yml');
    ComposeManager.saveCompose(hackerrunComposeData, hackerrunComposeFilePath);
    
    spinner.succeed('Deployment configuration created');
  } catch (error) {
    spinner.fail('Failed to create deployment configuration');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }

  // Create tar archive
  const archiveSpinner = ora('Creating deployment archive...').start();
  const tarPath = path.join(process.cwd(), 'hackerrun-deploy.tar.gz');
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  
  try {
    await ComposeManager.createTarArchive(process.cwd(), tarPath, gitignorePath);
    archiveSpinner.succeed('Deployment archive created');
  } catch (error) {
    archiveSpinner.fail('Failed to create deployment archive');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }

  // Connect to VPS
  const deploySpinner = ora('Connecting to VPS...').start();
  const ssh = new SSHClient(vpsIp);
  
  try {
    await ssh.connect();
    deploySpinner.succeed('Connected to VPS');
  } catch (error) {
    deploySpinner.fail('Failed to connect to VPS');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }

  // Upload and deploy
  const uploadSpinner = ora('Uploading deployment files...').start();
  
  try {
    // Create deployment directory
    const deployDir = '/opt/hackerrun/deployments/' + Date.now();
    await ssh.executeCommand(`mkdir -p ${deployDir}`);
    
    // Upload tar file
    await ssh.uploadFile(tarPath, `${deployDir}/app.tar.gz`);
    
    // Extract files
    await ssh.executeCommand(`cd ${deployDir} && tar -xzf app.tar.gz`);
    
    uploadSpinner.succeed('Files uploaded successfully');
  } catch (error) {
    uploadSpinner.fail('Failed to upload files');
    console.error(chalk.red('Error:'), error.message);
    await ssh.disconnect();
    process.exit(1);
  }

  // Copy Traefik configuration
  const configSpinner = ora('Setting up Traefik configuration...').start();
  
  try {
    const deployDir = '/opt/hackerrun/deployments/' + Math.floor(Date.now() / 1000);
    
    // Copy traefik config template
    const traefikConfigPath = path.join(process.cwd(), 'node_modules', 'hackerrun', 'templates', 'traefik.yml');
    if (fs.existsSync(traefikConfigPath)) {
      await ssh.uploadFile(traefikConfigPath, '/opt/hackerrun/traefik/traefik.yml');
    } else {
      // Fallback: create basic traefik config
      const basicTraefikConfig = `
api:
  dashboard: true
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@example.com
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
`;
      await ssh.executeCommand(`echo '${basicTraefikConfig}' > /opt/hackerrun/traefik/traefik.yml`);
    }
    
    configSpinner.succeed('Traefik configuration set up');
  } catch (error) {
    configSpinner.fail('Failed to setup Traefik configuration');
    console.error(chalk.red('Warning:'), error.message);
  }

  // Deploy application
  const appSpinner = ora('Deploying application...').start();
  
  try {
    const deployDir = await ssh.executeCommand('ls -1t /opt/hackerrun/deployments | head -1').then(output => 
      `/opt/hackerrun/deployments/${output.trim()}`
    );
    
    // Stop any existing deployment
    try {
      await ssh.executeCommand(`cd ${deployDir} && docker compose -f docker-compose.hackerrun.yml down`);
    } catch (error) {
      // Ignore errors if no previous deployment exists
    }
    
    // Start the new deployment
    await ssh.executeCommand(`cd ${deployDir} && docker compose -f docker-compose.hackerrun.yml up -d`);
    
    appSpinner.succeed('Application deployed successfully');
  } catch (error) {
    appSpinner.fail('Failed to deploy application');
    console.error(chalk.red('Error:'), error.message);
    await ssh.disconnect();
    process.exit(1);
  }

  await ssh.disconnect();

  // Clean up local files
  try {
    fs.unlinkSync(tarPath);
    fs.unlinkSync(path.join(process.cwd(), 'docker-compose.hackerrun.yml'));
  } catch (error) {
    // Ignore cleanup errors
  }

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