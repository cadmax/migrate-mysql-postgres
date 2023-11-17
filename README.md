# MySQL to PostgreSQL Migration Script - README

## Overview
This Node.js script facilitates data migration from a MySQL database to a PostgreSQL database. It automates creating tables, indexes, foreign keys, and data insertion while maintaining data integrity.

## Prerequisites
- Node.js installed
- MySQL and PostgreSQL servers running
- `mysql2` and `pg` NPM packages installed

## Configuration
Set up your database connection details at the beginning of the script:

```javascript
// MySQL configuration
const mysqlConfig = {
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'users',
  port: 3306
};

// PostgreSQL configuration
const postgresConfig = {
  host: 'localhost',
  user: 'postgres',
  password: 'postgres',
  database: 'users',
  port: 5432
};
```

## Features

- Converts MySQL data types to PostgreSQL-compatible types.
- Creates tables, primary keys, indexes, and foreign keys in PostgreSQL.
- Migrates data with null value handling and type conversion.
- Detailed migration process logging.

## How to Use
1. Adjust the connection settings for your databases.
2. Run npm install && npm run start
3. Monitor the process as the script migrates each table.

## Additional Information

- Supports auto-increment fields, enumerations, and JSON fields.
- SSL configuration for PostgreSQL is available but commented out.
- Assumes no restrictive constraints in MySQL that hinder direct migration.

## Contributing
Contributions for improvements or new features are welcome. Feel free to fork and submit pull requests.

## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
