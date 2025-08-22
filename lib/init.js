import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { SSHClient } from './ssh.js';
import { Config } from './config.js';
import { DockerContext } from './docker-context.js';

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

  // Set up Traefik service
  const setupSpinner = ora('Setting up Traefik service...').start();
  
  try {
    // Create traefik directory structure
    await ssh.executeCommand('mkdir -p /opt/hackerrun/traefik');
    await ssh.executeCommand('touch /opt/hackerrun/traefik/acme.json');
    await ssh.executeCommand('chmod 600 /opt/hackerrun/traefik/acme.json');
    
    // Create placeholder traefik.yml (will be updated during deploy with real email)
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
      email: admin@example.com
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web

log:
  level: INFO

accessLog: {}`;

    await ssh.executeCommand(`cat > /opt/hackerrun/traefik/traefik.yml << 'EOF'
${traefikYml}
EOF`);
    
    // Create Traefik compose file
    const traefikCompose = `
version: '3.8'

services:
  traefik:
    image: traefik:v3.0
    container_name: traefik
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /opt/hackerrun/traefik:/etc/traefik
    command:
      - --configfile=/etc/traefik/traefik.yml
    labels:
      - traefik.enable=true
      - traefik.http.routers.traefik.rule=Host(\`traefik.\${vpsIp}.sslip.io\`)
      - traefik.http.routers.traefik.entrypoints=websecure
      - traefik.http.routers.traefik.tls.certresolver=letsencrypt
      - traefik.http.services.traefik.loadbalancer.server.port=8080
    networks:
      - traefik

networks:
  traefik:
    name: traefik
    external: false
`;

    // Upload Traefik compose file
    await ssh.executeCommand(`cat > /opt/hackerrun/docker-compose.traefik.yml << 'EOF'${traefikCompose}EOF`);
    
    // Start Traefik service
    await ssh.executeCommand('cd /opt/hackerrun && docker compose -f docker-compose.traefik.yml up -d');
    
    setupSpinner.succeed('Traefik service started');
  } catch (error) {
    setupSpinner.fail('Failed to setup Traefik service');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }

  await ssh.disconnect();

  // Create Docker context
  const contextSpinner = ora('Creating Docker context for VPS...').start();
  const contextName = `hackerrun-${vpsIp.replace(/\./g, '-')}`;
  let originalContext;
  
  try {
    // Get current context to switch back later
    originalContext = await DockerContext.getCurrentContext();
    
    // Create context for the VPS
    await DockerContext.createContext(contextName, vpsIp);
    
    // Switch back to original context
    await DockerContext.useContext(originalContext);
    
    contextSpinner.succeed('Docker context created successfully');
  } catch (error) {
    contextSpinner.fail('Failed to create Docker context');
    console.error(chalk.red('Error:'), error.message);
    console.log(chalk.yellow('\nNote: You can still deploy using the traditional upload method.'));
  }

  // Save configuration
  Config.setVpsIp(vpsIp);
  
  console.log(chalk.green.bold('\n🎉 Initialization completed successfully!'));
  console.log(chalk.gray('Your VPS is now ready for Docker deployments.'));
  console.log(chalk.gray('\nNext step: Run'), chalk.cyan('hackerrun deploy'), chalk.gray('in a directory with docker-compose.yml'));
}