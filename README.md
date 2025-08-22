# HackerRun

A CLI tool to deploy Docker Compose applications to Ubuntu VPS with Traefik reverse proxy and automatic SSL certificates.

## Features

- 🚀 Easy VPS setup with automatic Docker installation
- 🔒 Automatic SSL certificates via Let's Encrypt
- 🌐 Uses sslip.io for instant domain access
- 📦 Supports any Docker Compose application
- 🔄 Traefik reverse proxy integration
- 🎯 Simple two-command deployment

## Installation

```bash
npm install -g hackerrun
```

## Quick Start

### 1. Initialize your VPS

```bash
hackerrun init
```

This will:
- Ask for your VPS IP address
- Install Docker and Docker Compose on your VPS
- Set up Traefik configuration

### 2. Deploy your application

In a directory with a `docker-compose.yml` file:

```bash
hackerrun deploy
```

This will:
- Parse your Docker Compose file
- Ask which service to expose to the internet
- Add Traefik labels for SSL and routing
- Deploy to your VPS
- Make your app available at `https://service-name.vps-ip.sslip.io`

## Prerequisites

- Ubuntu VPS with SSH access
- SSH key authentication set up
- Docker Compose application ready for deployment

## How it works

1. **VPS Setup**: HackerRun connects to your VPS via SSH and installs Docker
2. **Service Detection**: It reads your `docker-compose.yml` and lists available services
3. **Traefik Integration**: Adds Traefik labels to your selected service for reverse proxy
4. **Deployment**: Creates a tar archive, uploads it to VPS, and starts the containers
5. **SSL**: Traefik automatically requests SSL certificates from Let's Encrypt

## Configuration

HackerRun stores configuration in:
- Global config: `~/.hackerrun/config.json` (VPS IP)
- Project config: `.hackerrun.json` (deployment details)

## Example

```bash
# Initialize VPS
$ hackerrun init
🚀 HackerRun Initialization
Enter your VPS IP address: 192.168.1.100
✅ SSH connection successful
✅ Docker installed successfully
🎉 Initialization completed successfully!

# Deploy application
$ hackerrun deploy
🚀 HackerRun Deploy
✅ Found docker-compose.yml
📦 Found services: web, database
? Which service do you want to expose to the internet? web
? What port does web run on? 3000
🌐 Your app will be available at: https://web.192.168.1.100.sslip.io
🎉 Deployment completed successfully!
```

## License

MIT