import { Ball } from './game/Ball.js';
import GameLoop from './engine/GameLoop.js';
import { Paddle } from './game/Paddle.js';
import { Pong } from './game/Pong.js';
import { Wall } from './game/Wall.js';
import { Vector2 } from './engine/Physics/Vector2.js';
import { AIPaddle } from './game/AIPaddle.js';

const canvas = document.getElementById('fullscreenCanvas');
const ctx = canvas.getContext('2d');

function init() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    let ball = new Ball();
    let playerPaddle = new Paddle();

    let aiPaddle = new AIPaddle(playerPaddle, ball);

    let leftWall = new Wall(new Vector2(0, 0));
    let rightWall = new Wall(new Vector2(canvas.width - 20, 0));

    let pong = new Pong(ball);

    const gameLoop = new GameLoop(canvas, [pong, ball, leftWall, rightWall, aiPaddle, playerPaddle]);
    gameLoop.start();
}

window.onresize = () => {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
}

window.onload = init;