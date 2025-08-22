#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from '../lib/init.js';
import { deployCommand } from '../lib/deploy.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('hackerrun')
  .description('Deploy Docker Compose apps to Ubuntu VPS with Traefik')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize HackerRun by setting up VPS and installing Docker')
  .action(async () => {
    try {
      await initCommand();
    } catch (error) {
      console.error(chalk.red('Error during initialization:'), error.message);
      process.exit(1);
    }
  });

program
  .command('deploy')
  .description('Deploy your Docker Compose app to VPS with Traefik')
  .action(async () => {
    try {
      await deployCommand();
    } catch (error) {
      console.error(chalk.red('Error during deployment:'), error.message);
      process.exit(1);
    }
  });

program.parse();