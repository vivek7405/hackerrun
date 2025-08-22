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
      const sshKeyPath = path.join(os.homedir(), '.ssh', 'id_ed25519');
      
      let privateKey;
      try {
        privateKey = fs.readFileSync(sshKeyPath);
      } catch (error) {
        const rsaKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
        try {
          privateKey = fs.readFileSync(rsaKeyPath);
        } catch (rsaError) {
          reject(new Error(`SSH key not found. Checked ${sshKeyPath} and ${rsaKeyPath}`));
          return;
        }
      }

      this.conn.on('ready', () => {
        resolve();
      }).on('error', (err) => {
        reject(new Error(`SSH connection failed: ${err.message}`));
      }).connect({
        host: this.host,
        username: this.username,
        privateKey: privateKey
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