const moment = require('moment');

const Mappers = {
    String: (v) => (v || "").toString(),
    Number: (v) => parseFloat(v || "0"),
    Boolean: (v) => (v !== null && v !== undefined ? (v.toString().toLowerCase() == "true" || v == "1" || v == "on") : false),
    DateTime: (v) => moment(v),
    Guid: (v) => v,
    JsonObject: (v) => v !== null && v !== undefined ? JSON.parse(v) : null,
    Array: (v) => v !== undefined && v !== null ? (Array.isArray(v) ? v : [v]) : null,
};

/** @type {Mappers} */

const BindedMappers = {
};
for (var k in Mappers) {
    BindedMappers[k] = {
        bind: ((mapperFunc, key) => {
            return (data) => {
                return mapperFunc(data[key]);
            };
        }).bind(null, Mappers[k])
    };
}

module.exports = BindedMappers;
