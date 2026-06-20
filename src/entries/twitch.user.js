// ==UserScript==
// @name         Twitch Volume Slider 2.4.3
// @namespace    http://tampermonkey.net/
// @version      2.4.3
// @description  Compact in-bar volume indicator that expands into a wide Twitch volume slider.
// @author       isagie (Made using AI)
// @icon         https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png
// @match        https://www.twitch.tv/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

import { startTwitchVolumeSlider } from '../platforms/twitch.js';

startTwitchVolumeSlider();
