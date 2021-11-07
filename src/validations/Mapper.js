const moment = require('moment');

const Mappers = {
    String: (v) => (v || "").toString(),
    Number: (v) => v !== null && v !== undefined ? parseFloat(v) : v,
    Boolean: (v) => (v !== null && v !== undefined ? (v.toString().toLowerCase() == "true" || v == "1" || v == "on") : false),
    DateTime: (v) => moment(v).toDate(),
    Guid: (v) => v,
    JsonObject: (v) => v !== null && v !== undefined ? ((typeof v === "string") ? JSON.parse(v) : v) : null,
    Array: (v) => v !== undefined && v !== null ? (Array.isArray(v) ? v : [v]) : null,
};

/** @type {Mappers} */

const BindedMappers = {
};
for (var k in Mappers) {
    BindedMappers[k] = {
        bind: ((mapperFunc, mapperName, key) => {
            return (data) => {
                var v = data[key];
                if (mapperName !== "Array" && Array.isArray(v)) {
                    v = v[0];
                }
                return mapperFunc(v);
            };
        }).bind(null, Mappers[k], k)
    };
}

module.exports = BindedMappers;
