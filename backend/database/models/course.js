
module.exports = (sequelize, DataTypes) => {
  const Course = sequelize.define('Course', {
    id: {
      allowNull: false,
      autoIncrement: false,
      primaryKey: true,
      type: DataTypes.STRING,
    },
    maxCredits: DataTypes.INTEGER,
    minCredits: DataTypes.INTEGER,
    desc: DataTypes.TEXT,
    classId: DataTypes.STRING,
    url: DataTypes.STRING,
    prettyurl: DataTypes.STRING,
    name: DataTypes.STRING,
    lastUpdateTime: DataTypes.DATE,
    termId: DataTypes.STRING,
    host: DataTypes.STRING,
    subject: DataTypes.STRING,
    prereqs: DataTypes.JSON,
    coreqs: DataTypes.JSON,
    prereqsFor: DataTypes.JSON,
    optPrereqsFor: DataTypes.JSON,
    classAttributes: DataTypes.ARRAY(DataTypes.STRING),
  }, {});

  Course.associate = (models) => {
    Course.belongsToMany(models.User, {
      through: 'FollowedCourses',
      as: 'followers',
      foreignKey: 'courseId',
    });
  };

  return Course;
};
