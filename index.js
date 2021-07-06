const dbConfig = {
    client: "mssql",
    connection: {
        host: "localhost",
        user: "sa",
        password: "123456789",
        database: "testdb"
    }
};

const dbConnection = require('./src/databaseConnection');
const migration = require('./src/migration');
var db = new dbConnection(dbConfig);
var migrate = new migration(db);
migrate.registerSchemas(`${__dirname}/example`);
migrate.migrate();