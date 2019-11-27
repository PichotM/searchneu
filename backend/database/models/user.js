
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    messengerId: DataTypes.STRING,
    facebookPageId: DataTypes.STRING,
    firstName: DataTypes.STRING,
    lastName: DataTypes.STRING,
    loginKeys: DataTypes.ARRAY(DataTypes.STRING),
  }, {});

  return User;
};
