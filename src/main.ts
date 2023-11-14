import mysql from 'mysql2/promise';
import { Client } from 'pg';

interface MySQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface PostgresConfig {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  ssl?: {
    rejectUnauthorized: boolean;
  }
}

interface TableColumn {
  Field: string;
  Type: string;
  Extra: string;
}


interface ForeignKeyConstraint {
  constraint_name: string;
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

interface TableIndex {
  Key_name: string;
  Non_unique: number;
  Column_name: string;
}

const mysqlConfig: MySQLConfig = {
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'users',
  port: 3306
};

const postgresConfig: PostgresConfig = {
  host: 'localhost',
  user: 'postgres',
  password: 'postgres',
  database: 'users',
  port: 5432,
   // ssl: {
   //   rejectUnauthorized: false
   // }
};

function mysqlTypeToPostgresType(mysqlType: string, columnExtra: string): string {
  // Remove qualquer coisa entre parênteses incluindo os próprios parênteses e 'unsigned'
  const typeWithoutLength = mysqlType
    .replace(/\(\d+\)/, '')
    .replace(/\sunsigned/i, '');

  if (mysqlType.toLowerCase().includes('enum')) {
    return 'VARCHAR';
  }

  if (mysqlType.toLowerCase().includes('decimal')) {
    return 'NUMERIC';
  }

  if (mysqlType.toLowerCase().includes('char')) {
    return 'VARCHAR';
  }

  if (columnExtra.toLowerCase().includes('auto_increment')) {
    if (typeWithoutLength.toLowerCase() === 'bigint') {
      return 'BIGSERIAL';
    } else if (typeWithoutLength.toLowerCase() === 'int') {
      return 'SERIAL';
    } else {
      throw new Error(`Tipo não suportado para auto_increment: ${mysqlType}`);
    }
  }

  switch (typeWithoutLength.toLowerCase()) {
    // Adicione outros tipos conforme necessário
    case 'int':
    case 'tinyint':
    case 'smallint':
    case 'mediumint':
    case 'bigint':
      return 'INTEGER';
    case 'float':
      return 'REAL'; // No PostgreSQL, REAL é um tipo de ponto flutuante de precisão simples
    case 'double':
    case 'decimal':
      return 'NUMERIC';
    case 'datetime':
    case 'timestamp':
      return 'TIMESTAMP';
    case 'date':
      return 'DATE';
    case 'text':
    case 'tinytext':
    case 'mediumtext':
    case 'longtext':
      return 'TEXT';
    case 'char':
      return 'CHAR';
    case 'json':
      return 'JSON';
    case 'enum':
    case 'varchar':
      return 'VARCHAR'; // Se necessário, adicione um tamanho específico para VARCHAR
    default:
      throw new Error(`Tipo nao suportado: ${mysqlType}`);
  }
}

function getValue(value: any): any {
  if (value instanceof Date) {
    if (isNaN(value.valueOf())) {
      return null
    }
  }

  return value;
}


async function getMysqlForeignKeys(mysqlConnection: mysql.Connection, databaseName: string, tableName: string): Promise<ForeignKeyConstraint[]> {
  const query = `
    SELECT 
      constraint_name, 
      table_name, 
      column_name, 
      referenced_table_name AS foreign_table_name, 
      referenced_column_name AS foreign_column_name 
    FROM information_schema.key_column_usage 
    WHERE 
      referenced_table_schema = ? AND 
      table_name = ? AND 
      referenced_table_name IS NOT NULL;
  `;
  const [results] = await mysqlConnection.execute(query, [databaseName, tableName]) as unknown as [ForeignKeyConstraint[]];
  return results;
}

async function createPostgresForeignKeys(postgresClient: Client, foreignKeys: ForeignKeyConstraint[]): Promise<void> {
  try {
    await postgresClient.query('BEGIN');

    for (const chave of foreignKeys) {
      const key: any = Object.keys(chave).reduce((newObj, k) => {
        // @ts-ignore
        newObj[k.toLowerCase()] = chave[k];
        return newObj;
      }, {});

      const fkExistsQuery = `
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_type = 'FOREIGN KEY'
          AND table_name = $1
          AND constraint_name = $2;
      `;
      const fkExistsResult = await postgresClient.query(fkExistsQuery, [key.table_name, key.constraint_name]);

      // Se a chave estrangeira não existir, cria uma nova
      if (fkExistsResult.rows.length > 0) {
        console.info(`Chave estrangeira '${key.constraint_name}' já existe na tabela '${key.table_name}'.`);
        continue;
      }

      const createForeignKeyQuery = `
      ALTER TABLE "${key.table_name}" 
      ADD CONSTRAINT "${key.constraint_name}" 
      FOREIGN KEY ("${key.column_name}") 
      REFERENCES "${key.foreign_table_name}" ("${key.foreign_column_name}");
    `;

      await postgresClient.query(createForeignKeyQuery);
    }

    await postgresClient.query('COMMIT');
  } catch (error) {
    await postgresClient.query('ROLLBACK');
    throw error;
  }
}

async function getMysqlTableIndexes(mysqlConnection: mysql.Connection, tableName: string): Promise<TableIndex[]> {
  const [indexes] = await mysqlConnection.execute(`SHOW INDEX FROM ${tableName}`) as unknown as [TableIndex[]];
  return indexes;
}

async function createPrimaryKeys(postgresClient: Client, tableName: string, primaryKeyColumns: string[]): Promise<void> {
  const pkQuery = `
    SELECT i.relname as index_name
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE t.relkind = 'r' AND t.relname = $1 AND ix.indisprimary;
  `;
  const pkResult = await postgresClient.query(pkQuery, [tableName]);

  const hasPrimaryKey = pkResult.rows.length > 0;

  if (primaryKeyColumns.length > 0 && !hasPrimaryKey) {
    const primaryKeyQuery = `ALTER TABLE "${tableName}" ADD PRIMARY KEY (${primaryKeyColumns.join(', ')});`;
    await postgresClient.query(primaryKeyQuery);
  }
}

async function createPostgresIndexes(postgresClient: Client, tableName: string, mysqlIndexes: TableIndex[]): Promise<void> {
  // Acumular colunas da chave primária, pois podem haver chaves primárias compostas
  let primaryKeyColumns: string[] = [];
  const indexColumnsMap: { [keyName: string]: string[] } = {};


  for (const index of mysqlIndexes) {
    if (index.Key_name === 'PRIMARY') {
      // Adiciona a coluna à lista de colunas da chave primária
      primaryKeyColumns.push(`"${index.Column_name}"`);
    } else {
      if (!indexColumnsMap[index.Key_name]) {
        indexColumnsMap[index.Key_name] = [];
      }

      indexColumnsMap[index.Key_name].push(`"${index.Column_name}"`);
    }
  }

  for (const [keyName, columnNames] of Object.entries(indexColumnsMap)) {
    const indexType = mysqlIndexes.find(idx => idx.Key_name === keyName)?.Non_unique ? '' : 'UNIQUE ';
    const createIndexQuery = `CREATE ${indexType}INDEX IF NOT EXISTS "${keyName}" ON "${tableName}" (${columnNames.join(', ')});`;
    await postgresClient.query(createIndexQuery);
  }

  await createPrimaryKeys(postgresClient, tableName, primaryKeyColumns)
}

async function createTable (mysqlConnection: mysql.Connection, postgresClient: Client, tableName: string  ): Promise<void> {
  const [columns] = await mysqlConnection.execute(`DESCRIBE ${tableName}`) as unknown as [TableColumn[]];

  const columnDefinitions = columns.map(column => {
    const columnType = mysqlTypeToPostgresType(column.Type, column.Extra);
    return `"${column.Field}" ${columnType}`;
  }).join(', ')

  const createTableQuery = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefinitions});`;

  await postgresClient.query(createTableQuery);
}

async function insertData (mysqlConnection: mysql.Connection, postgresClient: Client, tableName: string): Promise<void> {
  const mysqlIndexes = await getMysqlTableIndexes(mysqlConnection, tableName);

  const primaryKeyColumns = mysqlIndexes.filter(index => index.Key_name === 'PRIMARY').map(index => index.Column_name);

  await postgresClient.query("SET session_replication_role = 'replica';");
  const execute = async (offset: number, limit: number) => {
    console.info('Buscando dados da tabela', tableName, 'offset', offset, 'limit', limit)
    const [rows] = await mysqlConnection.execute(`SELECT * FROM ${tableName} LIMIT ${limit} OFFSET ${offset}`) as unknown as [any[]];
    // Desativa as verificações de FK para a sessão atual

    console.info('Inserindo dados na tabela', tableName)
    const promiseList: any[] = []
    for (const row of rows) {
      const insertColumns = Object.keys(row).map(key => `"${key}"`).join(', ');
      const placeholders = Object.keys(row).map((_, index) => `$${index + 1}`).join(', ');
      const primaryKey = primaryKeyColumns.map(col => `"${col}"`).join(', ');

      // A cláusula ON CONFLICT é utilizada aqui para ignorar a inserção caso a entrada já exista
      // Assumindo que você tenha uma coluna ou um conjunto de colunas que defina(m) a unicidade da linha
      let insertQuery
      if (primaryKey) {
        insertQuery = `
        INSERT INTO "${tableName}" (${insertColumns}) 
        VALUES (${placeholders})
        ON CONFLICT (${primaryKey}) DO NOTHING;
      `;
      } else {
        insertQuery = `
        INSERT INTO "${tableName}" (${insertColumns}) 
        VALUES (${placeholders})
        ON CONFLICT DO NOTHING;
      `;
      }

      const rowValues = Object.values(row).map((value) => getValue(value));

      const p = postgresClient.query(insertQuery, rowValues);
      promiseList.push(p)
    }
    await Promise.all(promiseList)

    if (rows.length === limit) {
      await execute(offset + limit, limit)
    }
  }
  await execute(0, 1000)


  // Reativa as verificações de FK para a sessão atual
  await postgresClient.query("SET session_replication_role = 'origin';");

  console.info(`Tabela '${tableName}' migrada para o PostgreSQL.`);
}


async function createFks (mysqlConnection: mysql.Connection, postgresClient: Client, tableName: string  ): Promise<void> {
  const foreignKeys = await getMysqlForeignKeys(mysqlConnection, mysqlConfig.database, tableName);

  await createPostgresForeignKeys(postgresClient, foreignKeys);
}

async function migrateData(): Promise<void> {
  const skipTables: string[] = [];

  const mysqlConnection = await mysql.createConnection(mysqlConfig);
  const postgresClient = new Client(postgresConfig);
  await postgresClient.connect();

  try {
    await postgresClient.query('BEGIN');

    const [tables] = await mysqlConnection.execute(`SHOW TABLES`) as unknown as [any[]];

    for (const tableRow of tables) {
      const tableName = tableRow[`Tables_in_${mysqlConfig.database}`];
      if (skipTables.includes(tableName)) continue;

      await createTable(mysqlConnection, postgresClient, tableName)

      // Migrar índices
      const mysqlIndexes = await getMysqlTableIndexes(mysqlConnection, tableName);

      await createPostgresIndexes(postgresClient, tableName, mysqlIndexes);
    }

    await postgresClient.query('COMMIT');

    for (const tableRow of tables) {
      const tableName = tableRow[`Tables_in_${mysqlConfig.database}`];

      if (skipTables.includes(tableName)) continue;

       await createFks(mysqlConnection, postgresClient, tableName)
    }

    for (const tableRow of tables) {
      const tableName = tableRow[`Tables_in_${mysqlConfig.database}`];
      if (skipTables.includes(tableName)) continue;

      await insertData(mysqlConnection, postgresClient, tableName)
    }

    console.info('Migração concluída.');
  } catch (err) {
    await postgresClient.query('ROLLBACK');
    console.error('Erro durante a migração, alterações desfeitas:', err);
  } finally {
    if (mysqlConnection) await mysqlConnection.end();
    if (postgresClient) await postgresClient.end();
  }
}

migrateData();
