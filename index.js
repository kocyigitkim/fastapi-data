const DataRestBuilder = require('./src/DataRestBuilder');
const DataMigration = require('./src/migration');
const SchemaDBConnector = require('./src/SchemaDBConnector');
const SchemaParser = require('./src/schemaParser');
const DatabaseConnection = require('./src/databaseConnection');

module.exports = {
    DataRestBuilder: DataRestBuilder.DataRestBuilder,
    DataMigration,
    SchemaDBConnector: SchemaDBConnector.getDBConnector,
    SchemaParser,
    DatabaseConnection
};