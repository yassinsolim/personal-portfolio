const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCSSExtractPlugin = require('mini-css-extract-plugin');
const path = require('path');
const dracoWorker = require('../scripts/draco-worker.js');

// emits files built in node (the draco worker) as they are: already minified
// or emscripten output, so terser leaves them alone
class EmitFilesPlugin {
    constructor(files) {
        this.files = files;
    }

    apply(compiler) {
        const { Compilation, sources } = compiler.webpack;
        compiler.hooks.thisCompilation.tap('EmitFilesPlugin', (compilation) => {
            compilation.hooks.processAssets.tap(
                { name: 'EmitFilesPlugin', stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
                () => {
                    for (const [name, content] of Object.entries(this.files())) {
                        compilation.emitAsset(name, new sources.RawSource(content), { minimized: true });
                    }
                }
            );
        });
    }
}

module.exports = {
    entry: path.resolve(__dirname, '../src/script.ts'),
    output: {
        environment: {
            globalThis: true,
        },
        hashFunction: 'xxhash64',
        filename: 'bundle.[contenthash].js',
        globalObject: 'self',
        path: path.resolve(__dirname, '../build'),
    },
    plugins: [
        new EmitFilesPlugin(dracoWorker),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, '../static'),
                    globOptions: {
                        ignore: ['**/audio/**'],
                    },
                },
            ],
        }),
        new HtmlWebpackPlugin({
            template: path.resolve(__dirname, '../src/index.html'),
            minify: true,
        }),
        new MiniCSSExtractPlugin({
            chunkFilename: '[id].[contenthash].css',
            filename: 'bundle.[contenthash].css',
        }),
    ],
    resolve: {
        alias: {
            three: path.resolve('./node_modules/three'),
        },
        extensions: ['.tsx', '.ts', '.js'],
    },
    module: {
        rules: [
            // HTML
            {
                test: /\.(html)$/,
                use: ['html-loader'],
            },
            {
                test: /\.ts?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            // JS
            {
                test: /\.tsx$/,
                exclude: /node_modules/,
                use: ['babel-loader'],
            },

            // CSS
            {
                test: /\.css$/,
                use: [MiniCSSExtractPlugin.loader, 'css-loader'],
            },

            // Images
            {
                test: /\.(jpg|png|gif|svg)$/,
                type: 'asset/resource',
                generator: {
                    filename: 'assets/images/[hash][ext]',
                },
            },
            // Fonts
            {
                test: /\.(ttf|eot|woff|woff2)$/,
                type: 'asset/resource',
                generator: {
                    filename: 'assets/fonts/[hash][ext]',
                },
            },
            // Shaders
            {
                test: /\.(glsl|vs|fs|vert|frag)$/,
                exclude: /node_modules/,
                use: ['glslify-import-loader', 'raw-loader', 'glslify-loader'],
            },
        ],
    },
};
