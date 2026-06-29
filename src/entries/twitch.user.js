// ==UserScript==
// @name         Twitch Volume Slider
// @namespace    https://github.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders
// @version      2.6.5
// @description  Compact in-bar volume indicator that expands into a wide Twitch volume slider.
// @author       Gimbuhh (Made using AI)
// @icon         https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png
// @match        https://www.twitch.tv/*
// @updateURL    https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/twitch-volume-slider.user.js
// @downloadURL  https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/twitch-volume-slider.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

import { startTwitchVolumeSlider } from '../platforms/twitch.js';

startTwitchVolumeSlider();
