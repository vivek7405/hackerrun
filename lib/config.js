import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.hackerrun');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export class Config {
  static ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  static load() {
    this.ensureConfigDir();
    
    if (!fs.existsSync(CONFIG_FILE)) {
      return {};
    }

    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
  }

  static save(config) {
    this.ensureConfigDir();
    
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (error) {
      throw new Error(`Failed to save config: ${error.message}`);
    }
  }

  static getVpsIp() {
    const config = this.load();
    return config.vpsIp;
  }

  static setVpsIp(ip) {
    const config = this.load();
    config.vpsIp = ip;
    this.save(config);
  }

  static getProjectConfig() {
    const projectConfigPath = path.join(process.cwd(), '.hackerrun.json');
    
    if (!fs.existsSync(projectConfigPath)) {
      return {};
    }

    try {
      const data = fs.readFileSync(projectConfigPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return {};
    }
  }

  static saveProjectConfig(config) {
    const projectConfigPath = path.join(process.cwd(), '.hackerrun.json');
    
    try {
      fs.writeFileSync(projectConfigPath, JSON.stringify(config, null, 2));
    } catch (error) {
      throw new Error(`Failed to save project config: ${error.message}`);
    }
  }
}