const { withProjectBuildGradle } = require("@expo/config-plugins");

const CIRCLE_MAVEN_MARKER = "maven.pkg.github.com/circlefin/w3s-android-sdk";

const circleMavenRepository = `        maven {
            url System.getenv("PWSDK_MAVEN_URL") ?: "https://maven.pkg.github.com/circlefin/w3s-android-sdk"
            credentials {
                username System.getenv("PWSDK_MAVEN_USERNAME") ?: ""
                password System.getenv("PWSDK_MAVEN_PASSWORD") ?: ""
            }
        }`;

function addCircleMavenRepository(contents) {
  if (!contents || contents.includes(CIRCLE_MAVEN_MARKER) || contents.includes("PWSDK_MAVEN_URL")) {
    return contents;
  }

  const allProjectsRepositories = /(allprojects\s*\{\s*repositories\s*\{)/m;
  if (allProjectsRepositories.test(contents)) {
    return contents.replace(allProjectsRepositories, `$1\n${circleMavenRepository}`);
  }

  const firstRepositories = /(repositories\s*\{)/m;
  if (firstRepositories.test(contents)) {
    return contents.replace(firstRepositories, `$1\n${circleMavenRepository}`);
  }

  return `${contents}

allprojects {
    repositories {
${circleMavenRepository}
    }
}
`;
}

module.exports = function withCircleWalletMaven(config) {
  return withProjectBuildGradle(config, (config) => {
    config.modResults.contents = addCircleMavenRepository(config.modResults.contents);
    return config;
  });
};
