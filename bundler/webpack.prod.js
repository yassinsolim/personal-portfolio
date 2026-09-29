const path = require('path')
const webpack = require('webpack')
const { merge } = require('webpack-merge')
const commonConfiguration = require('./webpack.common.js')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
const assetVersions = require('../scripts/asset-versions.js')
const dracoWorker = require('../scripts/draco-worker.js')

module.exports = merge(
    commonConfiguration,
    {
        mode: 'production',
        devtool: false,
        plugins:
        [
            new CleanWebpackPlugin(),
            // content hashes of the static files, for their ?v= urls
            new webpack.DefinePlugin({
                __ASSET_VERSIONS__: JSON.stringify(assetVersions(path.resolve(__dirname, '../static'), dracoWorker())),
            }),
        ]
    }
)
