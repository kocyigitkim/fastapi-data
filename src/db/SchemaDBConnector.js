const knex = require('knex').default;
class SchemaDBConnector {
    /**
     * @param {knex} db
     */
    constructor(db) {
        this.db = db;
    }
    async find(tableName, whereCondition) {
        return new SchemaDBResult(await this.db(tableName).where(whereCondition).select('*').catch(console.error));
    }
    async findone(tableName, whereCondition) {
        return (new SchemaDBResult(await this.db(tableName).where(whereCondition).select('*').catch(console.error)) || {}).first;
    }
}

class SchemaDBResult {
    constructor(result) {
        this.result = result;
    }
    get first() {
        return (this.result || [])[0];
    }
    get last() {
        var list = (this.result || []);
        return list.length > 0 ? list[list.length - 1] : null;
    }
    get count() {
        return (this.result || []).length;
    }
}

module.exports = {
    getDBConnector: (db) => new SchemaDBConnector(db)
};