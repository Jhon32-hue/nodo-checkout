import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from './database-options';
import { loadDatabaseEnvironment } from './load-environment';

export default new DataSource(createDatabaseOptions(loadDatabaseEnvironment()));
