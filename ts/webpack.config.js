const
    path = require('path'),
    HtmlWebpackPlugin = require('html-webpack-plugin'),
    CopyPlugin = require("copy-webpack-plugin"),
    { CleanWebpackPlugin } = require('clean-webpack-plugin'),
    OverwolfPlugin = require('./overwolf.webpack');

module.exports = env => ({
    entry: {
        background: './src/background/background.ts',
        desktop: './src/desktop/desktop.ts',
        in_game: './src/in_game/in_game.ts',
        clicker: './src/clicker/clicker.ts',
        vignette: './src/vignette/vignette.ts'
    },
    devtool: 'inline-source-map',
    module: {
        rules: [
            {
                test: /\.ts?$/,
                use: 'ts-loader',
                exclude: /node_modules/
            }
        ]
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    output: {
        path: path.resolve(__dirname, 'dist/'),
        filename: 'js/[name].js'
    },
    plugins: [
        new CleanWebpackPlugin,
        new CopyPlugin({
            patterns: [
                // public/manifest.json is a stale, uncustomized copy of the original
                // Overwolf sample-app template (wrong manifest_version, placeholder
                // metadata, missing this app's real windows/hotkeys/game targeting) --
                // excluded here so it can never again get copied into dist/manifest.json
                // in place of the real one below. Found live 2026-08-31: a build
                // silently replaced the real dist/manifest.json with this stale file.
                { from: "public", to: "./", globOptions: { ignore: ["**/toggler_button.html", "**/manifest.json"] } },
                { from: "manifest.json", to: "manifest.json" }
            ],
        }),
        new HtmlWebpackPlugin({
            template: './src/background/background.html',
            filename: path.resolve(__dirname, './dist/background.html'),
            chunks: ['background']
        }),
        new HtmlWebpackPlugin({
            template: './src/desktop/desktop.html',
            filename: path.resolve(__dirname, './dist/desktop.html'),
            chunks: ['desktop']
        }),
        new HtmlWebpackPlugin({
            template: './src/in_game/in_game.html',
            filename: 'in_game.html',
            chunks: ['in_game']
        }),
        new HtmlWebpackPlugin({
            template: './src/clicker/clicker.html',
            filename: 'clicker.html',
            chunks: ['clicker']
        }),
        new HtmlWebpackPlugin({
            template: './src/vignette/vignette.html',
            filename: 'vignette.html',
            chunks: ['vignette']
        }),
        new OverwolfPlugin(env)
    ]
})
