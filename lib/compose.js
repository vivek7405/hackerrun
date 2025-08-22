import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { createReadStream, createWriteStream } from 'fs';
import tar from 'tar';
import { pipeline } from 'stream/promises';

export class ComposeManager {
  static parseCompose(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Docker Compose file not found: ${filePath}`);
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return YAML.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse Docker Compose file: ${error.message}`);
    }
  }

  static getServices(composeData) {
    if (!composeData.services) {
      throw new Error('No services found in Docker Compose file');
    }

    return Object.keys(composeData.services);
  }

  static addTraefikLabels(composeData, serviceName, domain) {
    if (!composeData.services[serviceName]) {
      throw new Error(`Service '${serviceName}' not found in Docker Compose file`);
    }

    const service = composeData.services[serviceName];
    
    // Initialize labels if not exists
    if (!service.labels) {
      service.labels = [];
    }

    // Convert labels to array format if it's an object
    if (typeof service.labels === 'object' && !Array.isArray(service.labels)) {
      service.labels = Object.entries(service.labels).map(([key, value]) => `${key}=${value}`);
    }

    // Add Traefik labels
    const traefikLabels = [
      'traefik.enable=true',
      `traefik.http.routers.${serviceName}.rule=Host(\`${domain}\`)`,
      `traefik.http.routers.${serviceName}.entrypoints=websecure`,
      `traefik.http.routers.${serviceName}.tls.certresolver=letsencrypt`,
      `traefik.http.services.${serviceName}.loadbalancer.server.port=80`
    ];

    // Add labels to the service
    service.labels = [...service.labels, ...traefikLabels];

    return composeData;
  }

  static addTraefikService(composeData) {
    // Add Traefik service if not exists
    if (!composeData.services.traefik) {
      composeData.services.traefik = {
        image: 'traefik:v3.0',
        container_name: 'traefik',
        restart: 'unless-stopped',
        ports: ['80:80', '443:443'],
        volumes: [
          '/var/run/docker.sock:/var/run/docker.sock:ro',
          './traefik:/etc/traefik'
        ],
        command: [
          '--api.dashboard=true',
          '--providers.docker=true',
          '--providers.docker.exposedbydefault=false',
          '--entrypoints.web.address=:80',
          '--entrypoints.websecure.address=:443',
          '--certificatesresolvers.letsencrypt.acme.email=admin@example.com',
          '--certificatesresolvers.letsencrypt.acme.storage=/etc/traefik/acme.json',
          '--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web'
        ],
        labels: [
          'traefik.enable=true',
          'traefik.http.routers.traefik.rule=Host(`traefik.${process.env.DOMAIN || "localhost"}`)',
          'traefik.http.routers.traefik.entrypoints=websecure',
          'traefik.http.routers.traefik.tls.certresolver=letsencrypt',
          'traefik.http.services.traefik.loadbalancer.server.port=8080'
        ]
      };
    }

    // Add networks if not exists
    if (!composeData.networks) {
      composeData.networks = {};
    }

    if (!composeData.networks.traefik) {
      composeData.networks.traefik = {
        external: false
      };
    }

    // Add traefik network to all services
    Object.keys(composeData.services).forEach(serviceName => {
      const service = composeData.services[serviceName];
      if (!service.networks) {
        service.networks = [];
      }
      if (Array.isArray(service.networks)) {
        if (!service.networks.includes('traefik')) {
          service.networks.push('traefik');
        }
      } else {
        service.networks.traefik = {};
      }
    });

    return composeData;
  }

  static saveCompose(composeData, filePath) {
    try {
      const yamlContent = YAML.stringify(composeData, { indent: 2 });
      fs.writeFileSync(filePath, yamlContent);
    } catch (error) {
      throw new Error(`Failed to save Docker Compose file: ${error.message}`);
    }
  }

  static async createTarArchive(sourceDir, outputPath, gitignorePath = null) {
    let ignore = ['node_modules', '.git', '*.log', '.DS_Store'];
    
    // Read .gitignore if it exists
    if (gitignorePath && fs.existsSync(gitignorePath)) {
      try {
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
        const gitignoreRules = gitignoreContent
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        ignore = [...ignore, ...gitignoreRules];
      } catch (error) {
        console.warn(`Warning: Could not read .gitignore: ${error.message}`);
      }
    }

    // Always include .env file even if it's in .gitignore
    ignore = ignore.filter(rule => rule !== '.env');

    try {
      await tar.create({
        file: outputPath,
        cwd: sourceDir,
        filter: (path) => {
          // Check if path matches any ignore pattern
          return !ignore.some(pattern => {
            // Simple pattern matching - can be enhanced with glob patterns
            if (pattern.includes('*')) {
              const regex = new RegExp(pattern.replace(/\*/g, '.*'));
              return regex.test(path);
            }
            return path.includes(pattern);
          });
        }
      }, ['.']);
    } catch (error) {
      throw new Error(`Failed to create tar archive: ${error.message}`);
    }
  }
}