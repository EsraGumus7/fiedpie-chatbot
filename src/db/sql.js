const sql = require("mssql");
const env = require("../config/env");

let pool = null;
let poolConnect = null;

function resetPool() {
  if (pool) {
    try {
      pool.close();
    } catch (_error) {
      // noop
    }
  }
  pool = null;
  poolConnect = null;
}

function validateDbConfig() {
  if (!env.db.server || !env.db.user || !env.db.password || !env.db.database) {
    throw new Error(
      "DB ayarlari eksik. .env icinde DB_SERVER, DB_USER, DB_PASSWORD, DB_DATABASE alanlarini doldurun."
    );
  }
}

function getPool() {
  if (!pool) {
    validateDbConfig();
    pool = new sql.ConnectionPool({
      user: env.db.user,
      password: env.db.password,
      server: env.db.server,
      database: env.db.database,
      port: env.db.port,
      options: {
        encrypt: env.db.encrypt,
        trustServerCertificate: env.db.trustServerCertificate,
      },
      connectionTimeout: 60000,
      requestTimeout: 60000,
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    });
    poolConnect = pool.connect();
  }
  return { pool, poolConnect };
}

async function getConnectedPoolWithRetry(maxRetries = 1) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const connection = getPool();
      await connection.poolConnect;
      return connection.pool;
    } catch (error) {
      lastError = error;
      resetPool();
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
  }

  const reason = lastError?.message || "Bilinmeyen baglanti hatasi";
  throw new Error(`Veritabani baglantisi basarisiz: ${reason}`);
}

async function queryDb(queryBuilder) {
  const connectedPool = await getConnectedPoolWithRetry(1);
  const request = connectedPool.request();
  const { query, bind = {} } = queryBuilder;

  Object.entries(bind).forEach(([key, value]) => {
    request.input(key, value);
  });

  return request.query(query);
}

module.exports = { sql, queryDb };
