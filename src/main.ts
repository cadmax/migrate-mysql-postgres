const mysql = require('mysql2/promise');
const { Client } = require('pg');

// Configurações de conexão para os bancos de dados
const mysqlConfig = {
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'users_db',
};

const postgresConfig = {
  host: 'localhost',
  user: 'postgres',
  password: 'postgres',
  database: 'users_db',
  port: 5432, // Porta padrão do PostgreSQL
};

// Função para converter tipos do MySQL para tipos do PostgreSQL
function mysqlTypeToPostgresType(mysqlType: string) {
  // Remove qualquer coisa entre parênteses incluindo os próprios parênteses e 'unsigned'
  const typeWithoutLength = mysqlType
    .replace(/\(\d+\)/, '')
    .replace(/\sunsigned/i, '');

  console.log('typeWithoutLength', typeWithoutLength);

  if (mysqlType.toLowerCase().includes('enum')) {
    return 'VARCHAR';
  }

  if (mysqlType.toLowerCase().includes('decimal')) {
    return 'NUMERIC';
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
    case 'enum':
    case 'varchar':
      return 'VARCHAR'; // Se necessário, adicione um tamanho específico para VARCHAR
    default:
      throw new Error(`Tipo nao suportado: ${mysqlType}`);
  }
}

function getValue(value: any) {
  if (value instanceof Date) {
    if (isNaN(value.valueOf())) {
      console.log('data invalida', value);
      return null;
    }
    return value;
  }

  return value;
}

async function migrateData() {
  const skipTables = ['migrations'];
  try {
    const mysqlConnection = await mysql.createConnection(mysqlConfig);

    const postgresClient = new Client(postgresConfig);
    await postgresClient.connect();

    const [tables] = await mysqlConnection.execute('SHOW TABLES');

    for (const tableRow of tables) {
      const tableName = tableRow[`Tables_in_${mysqlConfig.database}`];

      if (skipTables.includes(tableName)) continue;

      const [columns] = await mysqlConnection.execute(`DESCRIBE ${tableName}`);

      const columnDefinitions = columns
        .map((column: any) => {
          const columnType = mysqlTypeToPostgresType(column.Type);
          return `"${column.Field}" ${columnType}`;
        })
        .join(', ');
      const createTableQuery = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefinitions});`;

      console.log('createTableQuery', createTableQuery);

      await postgresClient.query(createTableQuery);

      const [rows] = await mysqlConnection.execute(
        `SELECT * FROM ${tableName}`,
      );

      const promiseList = [];

      for (const row of rows) {
        const insertColumns = Object.keys(row)
          .map((row) => `"${row}"`)
          .join(', ');

        const insertValues = Object.keys(row)
          .map((_, index) => `$${index + 1}`)
          .join(', ');

        const insertQuery = `INSERT INTO "${tableName}" (${insertColumns}) VALUES (${insertValues})`;

        const rowValues = Object.values(row).map((value) => getValue(value));

        console.log('insertQuery', insertQuery, rowValues);

        const p = postgresClient.query(insertQuery, rowValues);
        promiseList.push(p);
      }

      await Promise.all(promiseList);

      console.log(`Tabela '${tableName}' migrada para o PostgreSQL.`);
    }

    // Fechar conexões
    await mysqlConnection.end();
    await postgresClient.end();

    console.log('Migração concluída.');
  } catch (err) {
    console.error('Erro durante a migração:', err);
  }
}

migrateData();
