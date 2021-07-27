const fs = require("fs");
const test = require("flug");
const parseMRF = require("../src/core/parseMRF");

const getDirectories = source =>
  fs
    .readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

test("examples", ({ eq }) => {
  const dirs = getDirectories("./examples");
  dirs.forEach(dirname => {
    const mrfpath = `./examples/${dirname}/${dirname}.mrf`;
    console.log("checking " + mrfpath);
    const mrf = fs.readFileSync(mrfpath);
    const jsonpath = mrfpath + ".json";
    const parsed = parseMRF(mrf);
    if (!fs.existsSync(jsonpath))
      fs.writeFileSync(jsonpath, JSON.stringify(parsed, undefined, 2));
    const obj = JSON.parse(fs.readFileSync(jsonpath, "utf-8"));
    eq(parsed, obj);
  });
});
