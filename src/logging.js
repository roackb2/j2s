import winston from 'winston';

const config = {
    levels: {
        error: 0,
        warn: 1,
        info: 2,
        verbose: 3,
        debug: 4,
        silly: 5
    },
    colors: {
        error: 'red',
        warn: 'yellow',
        info: 'green',
        verbose: 'cyan',
        debug: 'blue',
        silly: 'magenta',
    },
    transports: [
        new(winston.transports.Console)({
            'timestamp': true,
            'colorize': true
        })
    ],
}

const logger = new(winston.Logger)(config);

module.exports = {
    config,
    logger
};
