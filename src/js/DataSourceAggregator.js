'use strict';

var DataSourceSorter = require('./DataSourceSorter');
var DataNodeTree = require('./DataNodeTree');
var DataNodeGroup = require('./DataNodeGroup');
var DataNodeLeaf = require('./DataNodeLeaf');

module.exports = (function() {

    //?[t,c,b,a]
    // t is a dataSource,
    // a is a dicitionary of aggregates,  columnName:function
    // b is a dicitionary of groupbys, columnName:sourceColumnName
    // c is a list of constraints,

    function DataSourceAggregator(dataSource) {
        this.dataSource = dataSource;
        this.aggregates = [];
        this.headers = [];
        this.groupBys = [];
        this.view = [];
        this.sorterInstance = {};
    }

    DataSourceAggregator.prototype.addAggregate = function(columnName, func) {
        this.headers.push(columnName);
        this.aggregates.push(func);
    };

    DataSourceAggregator.prototype.addGroupBy = function(columnIndex) {
        this.groupBys.push(columnIndex);
    };

    DataSourceAggregator.prototype.build = function() {
        this.buildGroupTree();
    };

    DataSourceAggregator.prototype.buildGroupTree = function() {
        var c, r, g, value, createFunc;
        var createBranch = function(key, map) {
            value = new DataNodeGroup(key);
            map.set(key, value);
            return value;
        };
        var createLeaf = function(key, map) {
            value = new DataNodeLeaf(key);
            map.set(key, value);
            return value;
        };
        var groupBys = this.groupBys;
        var source = this.dataSource;

        // lets sort our data first....
        for (c = 0; c < groupBys.length; c++) {
            g = groupBys[groupBys.length - c - 1];
            source = new DataSourceSorter(source);
            source.sortOn(g);
        }

        var rowCount = source.getRowCount();
        var tree = new DataNodeTree('root');
        var path = tree;
        var leafDepth = groupBys.length - 1;
        for (r = 0; r < rowCount; r++) {
            for (c = 0; c < groupBys.length; c++) {
                g = groupBys[c];
                value = source.getValue(g, r);

                //test that I'm not a leaf
                createFunc = (c === leafDepth) ? createLeaf : createBranch;
                path = path.children.getIfAbsent(value, createFunc);
            }
            path.rowIndexes.push(r);
            path = tree;
        }
        this.sorterInstance = new DataSourceSorter(source);
        tree.prune();
        this.tree = tree;
        this.tree.computeAggregates(this);
        this.buildView();
    };

    DataSourceAggregator.prototype.buildView = function() {
        this.view.length = 0;
        this.tree.computeHeight();
        this.tree.buildView(this);
    };

    DataSourceAggregator.prototype.getValue = function(x, y) {
        return this.view[y - 1].getValue(x); //header row
    };

    DataSourceAggregator.prototype.getColumnCount = function() {

        return this.aggregates.length + 1; // 1 is for the hierarchy column
    };

    DataSourceAggregator.prototype.getRowCount = function() {

        return this.tree.height + 1; //header column
    };

    DataSourceAggregator.prototype.click = function(y) {
        var group = this.view[y];
        group.toggleExpansionState();
        this.buildView();
    };

    DataSourceAggregator.prototype.getHeaders = function() {
        return this.headers;
    };

    DataSourceAggregator.prototype.getGrandTotals = function() {
        return this.view[0].data;
    };
    return DataSourceAggregator;

})();