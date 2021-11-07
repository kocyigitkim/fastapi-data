const DataRestBuilder = require('./src/routing/DataRestBuilder');
const DataRouterBuilder = require('./src/routing/DataRouterBuilder');
const DataActionBuilder = require('./src/routing/DataActionBuilder');
const DataMigration = require('./src/db/Migration');
const SchemaDBConnector = require('./src/db/SchemaDBConnector');
const SchemaParser = require('./src/db/SchemaParser');
const DatabaseConnection = require('./src/db/DatabaseConnection');
const Mapper = require('./src/validations/Mapper');

module.exports = {
    ...DataRestBuilder,
    ...DataRouterBuilder,
    ...DataActionBuilder,
    DataMigration,
    SchemaDBConnector: SchemaDBConnector.getDBConnector,
    SchemaParser,
    DatabaseConnection,
    Mapper: Mapper
};