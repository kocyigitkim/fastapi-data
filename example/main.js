const fastapi = require('fastapi-express');
const app = new fastapi.FastApi();
const datarestbuilder = require('../src/DataRestBuilder').DataRestBuilder;
app.oninit.addHandler(() => {
    const dbPlugin = new fastapi.KnexPlugin({
        client: "mssql",
        connection: {
            host: "localhost",
            user: "sa",
            password: "123456789",
            database: "testdb"
        }
    });
    app.registerPlugin(dbPlugin);

    var builder = new datarestbuilder();
    builder.init(dbPlugin.db, "./example/dbschemas");
    builder.build(app, __dirname + "/routers");
});

app.run();

module.exports = {};