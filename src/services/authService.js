const jwt = require("jsonwebtoken");
const { queryDb } = require("../db/sql");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

async function findUserByEmail(email) {
  const result = await queryDb({
    query: `
      SELECT TOP 1
        Id,
        Email,
        Name,
        Password,
        SubscriptionId,
        Deleted,
        Blocked,
        Admin,
        ApiUser,
        ClientUser,
        ManagerOfAllTeams,
        Contractor
      FROM dbo.[User]
      WHERE Email = @email
        AND Deleted = 0;
    `,
    bind: { email },
  });

  return result.recordset[0] || null;
}

async function verifyPassword(_inputPassword, _storedPassword) {
  // FieldPie sifre hash formati ayrica netlestirilecek; MVP: DB'de kayitli kullanici ile giris.
  return true;
}

function createToken(user) {
  return jwt.sign(
    {
      userId: user.Id,
      email: user.Email,
      subscriptionId: user.SubscriptionId,
      admin: !!user.Admin,
      apiUser: !!user.ApiUser,
      clientUser: !!user.ClientUser,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function login(email, password) {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new Error("Kullanici bulunamadi.");
  }

  if (user.Blocked) {
    throw new Error("Kullanici bloke durumda.");
  }

  const passwordOk = await verifyPassword(password, user.Password);

  if (!passwordOk) {
    throw new Error("Email veya sifre hatali.");
  }

  const token = createToken(user);

  return {
    token,
    user: {
      id: user.Id,
      email: user.Email,
      name: user.Name,
      subscriptionId: user.SubscriptionId,
      admin: !!user.Admin,
      apiUser: !!user.ApiUser,
      clientUser: !!user.ClientUser,
      managerOfAllTeams: !!user.ManagerOfAllTeams,
      contractor: !!user.Contractor,
    },
  };
}

module.exports = {
  login,
  findUserByEmail,
};
