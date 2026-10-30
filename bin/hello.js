#!/usr/bin/env node
import { formatGreeting, parseCliArgs } from '../src/greet.js';

const { name } = parseCliArgs(process.argv.slice(2));
process.stdout.write(`${formatGreeting(name)}\n`);