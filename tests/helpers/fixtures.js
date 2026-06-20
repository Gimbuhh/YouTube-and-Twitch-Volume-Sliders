export function youtubeFixture(document) {
  document.body.innerHTML = '<div id="movie_player"><video class="html5-main-video"></video><div class="ytp-left-controls"><div class="ytp-volume-area"></div></div><div class="ytp-right-controls"><button class="ytp-settings-button"></button></div></div>';
  const player = document.getElementById('movie_player');
  const video = player.querySelector('video');
  let volume = 50, muted = false;
  Object.assign(player, { getVolume:()=>volume, setVolume:v=>{volume=v;}, isMuted:()=>muted, mute:()=>{muted=true;}, unMute:()=>{muted=false;} });
  return { player, video, state: { get volume(){return volume;}, get muted(){return muted;} } };
}

export function twitchFixture(document) {
  document.body.innerHTML = '<div class="video-player" data-a-target="player-overlay-click-handler"><video></video><div data-a-target="player-controls"><div class="player-controls__left-control-group"><div data-a-target="player-volume-slider"></div></div><div class="player-controls__right-control-group"><button data-a-target="player-settings-button" aria-label="Settings"></button></div></div></div>';
  const player = document.querySelector('.video-player');
  const video = player.querySelector('video');
  let volume = .5, muted = false;
  player._tmPlayerApi = { getVolume:()=>volume, setVolume:v=>{volume=v;}, isMuted:()=>muted, setMuted:v=>{muted=v;} };
  player.__reactFiber$test = { return: { memoizedProps: { mediaPlayerInstance: player._tmPlayerApi }, return: null } };
  return { player, video, state: { get volume(){return volume;}, get muted(){return muted;} } };
}
