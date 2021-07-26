const test = require('flug');
const cluster = require('../src/utils/cluster');

test('clustering', ({ eq }) => {
    const objs = [
        { start: 10, end: 15 },
        { start: 16, end: 52 },
        { start: 3, end: 7 }
    ];
    const ranges = cluster(objs);
    eq(ranges, [
        { start: 3, end: 7, objs: [ { end: 7, start: 3, }, ] },
        { start: 10, end: 52, objs: [ { end: 15, start: 10, }, { end: 52, start: 16, }, ] }
    ]);
});
