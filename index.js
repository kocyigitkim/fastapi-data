const DataRestBuilder = require('./src/DataRestBuilder');
const DataMigration = require('./src/migration');
const SchemaDBConnector = require('./src/SchemaDBConnector');
const SchemaParser = require('./src/schemaParser');
const DatabaseConnection = require('./src/databaseConnection');
const Mapper = require('./src/Mapper');

module.exports = {
    ...DataRestBuilder,
    DataMigration,
    SchemaDBConnector: SchemaDBConnector.getDBConnector,
    SchemaParser,
    DatabaseConnection,
    Mapper: Mapper
};