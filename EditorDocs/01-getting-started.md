# Getting started

Piston is a game editor with a built-in 2D engine. You build games out of **scenes** (levels) made of **entities** (things in the world), and give entities behaviour with **components** and **scripts**. Games run on the web today; Android and iOS are planned.

## Your first project
1. On the Hub, choose **New Project**, pick the web platform, and name it. You get a blank project with one scene.
2. Press **+** in the Hierarchy and add something (a Polygon for ground, an Empty to hold components).
3. Select it and change its values in the **Inspector** on the right. Drag it in the Scene view.
4. Press **Play** (⌘R) to run the game in the Game tab. **Stop** (⌘.) throws the running game away; nothing you did while playing changes your scene.
5. **Save** with ⌘S. Your work is plain files in your project folder.

## What a project contains
| Folder | Holds |
|---|---|
| `scenes/` | One `.json` file per scene. Every file in this folder is a scene. |
| `scripts/` | Your JavaScript: entities, components, game logic. |
| `assets/` | Images, sounds, anything your game loads. |
| `prefabs/` | Saved entity templates. |
| `project.piston.json` | Project settings: name, start scene, game resolution, scene order. |

The engine itself ships inside Piston. It is never copied into your project.

## The three kinds of state
- **Project data**: your scenes and files. This is what Save writes.
- **Editor state**: selection, camera, grid, tabs. Never saved into a scene.
- **Game state**: lives only inside a running game. Stop discards it.

## Where to go next
- [Editor tour](doc:02-editor-tour) for everything on screen.
- [Scenes and levels](doc:03-scenes-and-levels) for moving between levels.
- [Entities and components](doc:04-entities-and-components) for writing your own.
