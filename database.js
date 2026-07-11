const mysql = require('mysql2');

module.exports = function createConnectionPool(config) {
  const pool = mysql.createPool({
    host: config.host || process.env.DB_HOST,
    user: config.user || process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    //password: "1234",
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  pool.getConnection((err, connection) => {
    if (err) {
      console.error("❌ Database connection failed:", err.message);
    } else {
      console.log("✅ Database connected successfully!");
      connection.release(); // Release the connection back to the pool
    }
  });

  return {
    query: async function(sql, values) {
      const [rows, fields] = await pool.promise().query(sql, values);
      return rows;
    }
  };
};
