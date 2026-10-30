#!/usr/bin/env node
import { formatGreeting } from '../src/greet.js';

process.stdout.write(`${formatGreeting()}\n`);