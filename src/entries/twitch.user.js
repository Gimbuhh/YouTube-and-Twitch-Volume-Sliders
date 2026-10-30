// ==UserScript==
// @name         Twitch Volume Slider
// @namespace    https://github.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders
// @version      3.0.2
// @description  Compact Twitch volume controls with optional automatic volume normalization.
// @author       Gimbuhh (Made using AI)
// @icon         https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png
// @match        https://www.twitch.tv/*
// @match        https://*.ext-twitch.tv/*
// @updateURL    https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/twitch-volume-slider.user.js
// @downloadURL  https://raw.githubusercontent.com/Gimbuhh/YouTube-and-Twitch-Volume-Sliders/main/dist/twitch-volume-slider.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

import { startTwitchVolumeSlider } from '../platforms/twitch.js';
import { startTwitchExtensionKeys } from '../platforms/twitch-extension-keys.js';

if (location.hostname.endsWith('.ext-twitch.tv')) startTwitchExtensionKeys(window);
else startTwitchVolumeSlider();
