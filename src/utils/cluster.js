// takes in an array of objects with start and end properties
// matches them into groups if share an integer boundary
// one begins where the other ends and vice versa

function cluster(objs) {
  // sort objects in case they are not already sorted
  objs = Array.from(objs).sort((a, b) => Math.sign(a.end - b.end));

  const first = objs[0];
  let range = { start: first.start, end: first.end, objs: [first] };
  const ranges = [range];

  for (let i = 1; i < objs.length; i++) {
    const obj = objs[i];
    // see if adjacent to previous range
    if (obj.start === range.end + 1) {
      range.objs.push(obj);
      range.end = obj.end;
    } else {
      range = { start: obj.start, end: obj.end, objs: [obj] };
      ranges.push(range);
    }
  }
  return ranges;
}

module.exports = cluster;
