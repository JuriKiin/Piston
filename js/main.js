import GameLoop from './engine/GameLoop.js';
import { Wall } from './game/Wall.js';
import { Vector2 } from './engine/Physics/Vector2.js';
import { Player } from './game/Player.js';
import { WaterDrop } from './game/WaterDrop.js';
import { Gruff } from './game/Gruff.js';

const canvas = document.getElementById('fullscreenCanvas');
const ctx = canvas.getContext('2d');

function init() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    let player = new Player();
    let gruff = new Gruff();

    let topWall = new Wall(new Vector2(canvas.width / 2, 10), new Vector2(canvas.width, 20));
    let bottomWall = new Wall(new Vector2(canvas.width / 2, canvas.height - 10), new Vector2(canvas.width, 20));
    let leftWall = new Wall(new Vector2(10, canvas.height / 2), new Vector2(20, canvas.height));
    let rightWall = new Wall(new Vector2(canvas.width - 10, canvas.height / 2), new Vector2(20, canvas.height));

    const drops = [];
    for (let i = 0; i < 0; i++) {
        drops.push(new WaterDrop(50, new Vector2(5, 5)));
    }

    const gameLoop = new GameLoop(canvas, [player, gruff, topWall, bottomWall, leftWall, rightWall, ...drops]);
    gameLoop.start();
}

window.onresize = () => {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
}

window.onload = init;