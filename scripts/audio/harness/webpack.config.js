// bundles the offline render harness (scripts/audio/harness/entry.ts)
const path = require('path');

module.exports = {
    mode: 'development',
    devtool: false,
    entry: path.resolve(__dirname, 'entry.ts'),
    output: {
        path: path.resolve(__dirname, '../../../.tmp-validation/audio-harness'),
        filename: 'harness.js',
    },
    resolve: { extensions: ['.ts', '.js'] },
    module: {
        rules: [
            {
                test: /\.ts$/,
                loader: 'ts-loader',
                exclude: /node_modules/,
                options: {
                    transpileOnly: true,
                    configFile: path.resolve(__dirname, 'tsconfig.json'),
                },
            },
        ],
    },
};
