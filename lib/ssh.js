import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import os from 'os';

export class SSHClient {
  constructor(host, username = 'root') {
    this.host = host;
    this.username = username;
    this.conn = new Client();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const privateKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
      let authMethod = {};

      // Try to use SSH key first
      if (fs.existsSync(privateKeyPath)) {
        authMethod = {
          privateKey: fs.readFileSync(privateKeyPath)
        };
      } else {
        // Fallback to agent-based authentication
        authMethod = {
          agent: process.env.SSH_AUTH_SOCK
        };
      }

      this.conn.on('ready', () => {
        resolve();
      }).on('error', (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      }).connect({
        host: this.host,
        username: this.username,
        ...authMethod
      });
    });
  }

  async executeCommand(command) {
    return new Promise((resolve, reject) => {
      this.conn.exec(command, (err, stream) => {
        if (err) {
          reject(new Error(`Command execution failed: ${err.message}`));
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Command failed with code ${code}: ${stderr}`));
          } else {
            resolve(stdout);
          }
        }).on('data', (data) => {
          stdout += data;
        }).stderr.on('data', (data) => {
          stderr += data;
        });
      });
    });
  }

  async uploadFile(localPath, remotePath) {
    return new Promise((resolve, reject) => {
      this.conn.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP connection failed: ${err.message}`));
          return;
        }

        sftp.putFile(localPath, remotePath, (err) => {
          if (err) {
            reject(new Error(`File upload failed: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    });
  }

  async disconnect() {
    this.conn.end();
  }
}