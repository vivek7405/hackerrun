import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { SSHClient } from './ssh.js';
import { Config } from './config.js';

const DOCKER_INSTALL_SCRIPT = `
#!/bin/bash
set -e

echo "Updating system packages..."
apt-get update

echo "Installing required packages..."
apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release

echo "Adding Docker GPG key..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

echo "Adding Docker repository..."
echo "deb [arch=\$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \$(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

echo "Updating package index..."
apt-get update

echo "Installing Docker..."
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "Starting Docker service..."
systemctl start docker
systemctl enable docker

echo "Creating docker group and adding user..."
groupadd -f docker
usermod -aG docker \$USER

echo "Testing Docker installation..."
docker --version
docker compose version

echo "Docker installation completed successfully!"
`;

export async function initCommand() {
  console.log(chalk.blue.bold('🚀 HackerRun Initialization'));
  console.log(chalk.gray('Setting up your VPS for Docker deployments...\n'));

  // Check if already initialized
  const existingVpsIp = Config.getVpsIp();
  if (existingVpsIp) {
    const { reinitialize } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'reinitialize',
        message: `VPS already configured (${existingVpsIp}). Do you want to reconfigure?`,
        default: false
      }
    ]);

    if (!reinitialize) {
      console.log(chalk.green('✅ Using existing VPS configuration'));
      return;
    }
  }

  // Get VPS IP address
  const { vpsIp } = await inquirer.prompt([
    {
      type: 'input',
      name: 'vpsIp',
      message: 'Enter your VPS IP address:',
      validate: (input) => {
        const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
        if (!ipRegex.test(input)) {
          return 'Please enter a valid IP address';
        }
        return true;
      }
    }
  ]);

  console.log(chalk.yellow('\\n📡 Testing SSH connection...'));
  
  const ssh = new SSHClient(vpsIp);
  
  try {
    await ssh.connect();
    console.log(chalk.green('✅ SSH connection successful'));
  } catch (error) {
    console.error(chalk.red('❌ SSH connection failed:'), error.message);
    console.log(chalk.yellow('\nTroubleshooting tips:'));
    console.log('- Ensure your SSH key is added to the VPS (~/.ssh/authorized_keys)');
    console.log('- Check if the VPS is accessible and running');
    console.log('- Verify the IP address is correct');
    process.exit(1);
  }

  // Check if Docker is already installed
  let dockerInstalled = false;
  const spinner = ora('Checking Docker installation...').start();
  
  try {
    await ssh.executeCommand('docker --version && docker compose version');
    dockerInstalled = true;
    spinner.succeed('Docker is already installed');
  } catch (error) {
    spinner.info('Docker not found, will install it');
  }

  if (!dockerInstalled) {
    const installSpinner = ora('Installing Docker on VPS...').start();
    
    try {
      // Create and upload install script
      const scriptPath = '/tmp/install-docker.sh';
      await ssh.executeCommand(`echo '${DOCKER_INSTALL_SCRIPT}' > ${scriptPath}`);
      await ssh.executeCommand(`chmod +x ${scriptPath}`);
      
      // Run installation
      await ssh.executeCommand(`${scriptPath}`);
      
      installSpinner.succeed('Docker installed successfully');
      
      console.log(chalk.yellow('\n⚠️  Note: You may need to log out and back in for Docker group changes to take effect'));
    } catch (error) {
      installSpinner.fail('Docker installation failed');
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  }

  // Create traefik directory structure
  const setupSpinner = ora('Setting up Traefik configuration...').start();
  
  try {
    await ssh.executeCommand('mkdir -p /opt/hackerrun/traefik');
    await ssh.executeCommand('touch /opt/hackerrun/traefik/acme.json');
    await ssh.executeCommand('chmod 600 /opt/hackerrun/traefik/acme.json');
    setupSpinner.succeed('Traefik configuration set up');
  } catch (error) {
    setupSpinner.fail('Failed to setup Traefik configuration');
    console.error(chalk.red('Error:'), error.message);
  }

  await ssh.disconnect();

  // Save configuration
  Config.setVpsIp(vpsIp);
  
  console.log(chalk.green.bold('\n🎉 Initialization completed successfully!'));
  console.log(chalk.gray('Your VPS is now ready for Docker deployments.'));
  console.log(chalk.gray('\nNext step: Run'), chalk.cyan('hackerrun deploy'), chalk.gray('in a directory with docker-compose.yml'));
}