import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class DockerContext {
  static async getCurrentContext() {
    try {
      const { stdout } = await execAsync('docker context show');
      return stdout.trim();
    } catch (error) {
      throw new Error(`Failed to get current Docker context: ${error.message}`);
    }
  }

  static async createContext(name, host, sshKey = null) {
    try {
      // Remove existing context if it exists
      try {
        await execAsync(`docker context rm ${name}`);
      } catch (error) {
        // Ignore error if context doesn't exist
      }

      // Create new context
      const sshKeyOption = sshKey ? ` --ssh-key ${sshKey}` : '';
      const command = `docker context create ${name} --docker "host=ssh://root@${host}"${sshKeyOption}`;
      
      await execAsync(command);
      return true;
    } catch (error) {
      throw new Error(`Failed to create Docker context: ${error.message}`);
    }
  }

  static async useContext(contextName) {
    try {
      await execAsync(`docker context use ${contextName}`);
      return true;
    } catch (error) {
      throw new Error(`Failed to switch to Docker context '${contextName}': ${error.message}`);
    }
  }

  static async removeContext(contextName) {
    try {
      await execAsync(`docker context rm ${contextName}`);
      return true;
    } catch (error) {
      throw new Error(`Failed to remove Docker context '${contextName}': ${error.message}`);
    }
  }

  static async listContexts() {
    try {
      const { stdout } = await execAsync('docker context ls --format json');
      return JSON.parse(`[${stdout.trim().split('\n').join(',')}]`);
    } catch (error) {
      throw new Error(`Failed to list Docker contexts: ${error.message}`);
    }
  }

  static async contextExists(contextName) {
    try {
      const contexts = await this.listContexts();
      return contexts.some(ctx => ctx.Name === contextName);
    } catch (error) {
      return false;
    }
  }
}