import { VOLUME_STEPS } from './volume.js';

export function createOptionsUi(dependencies) {
  const {
    document, optionsPopupId: OPTIONS_POPUP_ID, refreshOptionsPopupState,
    getVolumeSliderMode, setVolumeSliderMode, getReplaceNativePlacement, setReplaceNativePlacement,
    getVolumeAppearance, setVolumeAppearance,
    isNormalizationEnabled, setNormalizationEnabled, getNormalizationStatus, getNormalizationDetails,
    getVolumeStep, setVolumeStep, isAlwaysExpandedEnabled, setAlwaysExpandedEnabled,
    isSliderOnVideo, setSliderLocation, getSavedOverlayOpacityPercent,
    setSavedOverlayOpacityPercent, resetSavedOverlayOpacityPercent,
    getSavedOverlaySizePercent, setSavedOverlaySizePercent, resetSavedOverlaySizePercent,
    getSavedSliderThicknessPercent, setSavedSliderThicknessPercent, resetSavedSliderThicknessPercent,
    beginThicknessSliderPreview, endThicknessSliderPreview,
    beginOpacitySliderPreview, endOpacitySliderPreview
  } = dependencies;

  const previewEndEvents = ['pointerup', 'pointercancel', 'mouseup', 'touchend', 'touchcancel'];
  const previewTargets = [document, document.defaultView].filter(Boolean);
  let activePreview = null;

  function stopOptionsPreview() {
    const preview = activePreview;
    if (!preview) {
      return;
    }
    activePreview = null;
    for (const target of previewTargets) {
      for (const type of previewEndEvents) {
        target.removeEventListener(type, stopOptionsPreview, true);
      }
    }
    preview.onEnd?.();
  }

    function getEnabledRadios(group) {
        return Array.from(group.querySelectorAll('[role="radio"]:not(:disabled)'));
    }

    function syncOptionsRadioGroups(popup) {
        popup?.querySelectorAll('[role="radiogroup"]').forEach((group) => {
            const radios = getEnabledRadios(group);
            const checked = radios.find((radio) => radio.getAttribute('aria-checked') === 'true');
            const tabStop = checked || radios[0];
            group.querySelectorAll('[role="radio"]').forEach((radio) => {
                radio.tabIndex = radio === tabStop ? 0 : -1;
            });
        });
    }

    function syncNormalizationStatus(popup) {
        if (!popup) return;
        const normalizationStatus = popup.querySelector('#tm-volume-options-normalization-status');
        const status = getNormalizationStatus();
        if (normalizationStatus && normalizationStatus.textContent !== status) normalizationStatus.textContent = status;
        if (normalizationStatus) normalizationStatus.dataset.state = status.startsWith('Active') ? 'active' : 'idle';
        const feedback = popup.querySelector('.tm-volume-options-normalization-feedback');
        if (feedback) feedback.hidden = !isNormalizationEnabled();
        const normalizationDetails = popup.querySelector('#tm-volume-options-normalization-details');
        const details = getNormalizationDetails();
        if (normalizationDetails) {
            if (normalizationDetails.textContent !== details) normalizationDetails.textContent = details;
            normalizationDetails.hidden = !details;
        }
    }

    function syncOptionsPopupState(popup) {
        if (!popup) return;

        const selectedMode = getVolumeSliderMode();
        const selectedPlacement = getReplaceNativePlacement();
        const selectedAppearance = getVolumeAppearance();
        const selectedStep = getVolumeStep();
        const onVideo = isSliderOnVideo();

        popup.querySelector('#tm-volume-options-normalization')
            ?.setAttribute('aria-checked', isNormalizationEnabled() ? 'true' : 'false');
        syncNormalizationStatus(popup);

        const modeSelect = popup.querySelector('#tm-volume-options-mode');
        if (modeSelect) modeSelect.value = selectedMode;

        const placementSection = popup.querySelector('#tm-volume-options-placement-section');
        const placementEnabled = selectedMode === 'replace-native';
        if (placementSection) {
            placementSection.dataset.disabled = placementEnabled ? 'false' : 'true';
        }
        ['native', 'custom'].forEach((placement) => {
            const radio = popup.querySelector(`#tm-volume-options-placement-${placement}`);
            if (!radio) return;
            radio.setAttribute('aria-checked', selectedPlacement === placement ? 'true' : 'false');
            radio.disabled = !placementEnabled;
        });

        ['new', 'classic'].forEach((appearance) => {
            popup.querySelector(`#tm-volume-options-appearance-${appearance}`)
                ?.setAttribute('aria-checked', selectedAppearance === appearance ? 'true' : 'false');
        });

        VOLUME_STEPS.forEach((step) => {
            popup.querySelector(`#tm-volume-options-step-${step}`)
                ?.setAttribute('aria-checked', selectedStep === step ? 'true' : 'false');
        });
        popup.querySelector('#tm-volume-options-always-expanded')
            ?.setAttribute('aria-checked', isAlwaysExpandedEnabled() ? 'true' : 'false');
        popup.querySelector('#tm-volume-options-location-video')
            ?.setAttribute('aria-checked', onVideo ? 'true' : 'false');

        const onVideoDisplay = onVideo ? '' : 'none';
        const opacitySection = popup.querySelector('#tm-volume-options-opacity-section');
        if (opacitySection) opacitySection.style.display = onVideoDisplay;
        const sizeSection = popup.querySelector('#tm-volume-options-size-section');
        if (sizeSection) sizeSection.style.display = onVideoDisplay;
        const appearanceHint = popup.querySelector('.tm-volume-options-appearance-hint');
        if (appearanceHint) appearanceHint.hidden = onVideo;

        syncOptionsRadioGroups(popup);
    }

    function handleRadioNavigation(event) {
        const radio = event.currentTarget;
        const group = radio.closest('[role="radiogroup"]');
        if (!group) return;
        const radios = getEnabledRadios(group);
        const currentIndex = radios.indexOf(radio);
        if (currentIndex < 0) return;

        let nextIndex;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            nextIndex = (currentIndex - 1 + radios.length) % radios.length;
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            nextIndex = (currentIndex + 1) % radios.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else if (event.key === 'End') {
            nextIndex = radios.length - 1;
        } else {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const next = radios[nextIndex];
        next.click();
        next.focus();
    }

    function createOptionsButtonLabel(label) {
        const text = document.createElement('span');
        text.className = 'tm-volume-options-button-label';
        text.textContent = label;
        return text;
    }

    function createOptionsCheckboxRow(id, label, isChecked, onToggle) {
        const row = document.createElement('button');
        row.type = 'button';
        row.id = id;
        row.className = 'tm-volume-options-row';
        row.setAttribute('role', 'checkbox');
        row.setAttribute('aria-checked', isChecked ? 'true' : 'false');

        const text = createOptionsButtonLabel(label);

        const box = document.createElement('span');
        box.className = 'tm-volume-options-checkbox';
        box.setAttribute('aria-hidden', 'true');

        row.appendChild(text);
        row.appendChild(box);

        row.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const next = row.getAttribute('aria-checked') !== 'true';
            row.setAttribute('aria-checked', next ? 'true' : 'false');
            onToggle(next);
            refreshOptionsPopupState();
        });
        return row;
    }

    function createOptionsRadio(id, label, isChecked, onSelect) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = id;
        btn.className = 'tm-volume-options-radio';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', isChecked ? 'true' : 'false');
        btn.tabIndex = isChecked ? 0 : -1;
        btn.appendChild(createOptionsButtonLabel(label));
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelect();
            refreshOptionsPopupState();
        });
        btn.addEventListener('keydown', handleRadioNavigation);
        return btn;
    }

    function createOptionsSectionLabel(text) {
        const label = document.createElement('div');
        label.className = 'tm-volume-options-section-label';
        label.textContent = text;
        return label;
    }

    function createOptionsSegment(radios) {
        const segment = document.createElement('div');
        segment.className = 'tm-volume-options-segment';
        radios.forEach((radio) => segment.appendChild(radio));
        return segment;
    }

    function createModeSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-mode';
        const label = document.createElement('label');
        label.htmlFor = 'tm-volume-options-mode';
        label.textContent = 'Mode';
        const select = document.createElement('select');
        select.id = label.htmlFor;
        for (const [value, text] of [['on', 'On'], ['off', 'Off'], ['replace-native', 'Replace native']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            select.appendChild(option);
        }
        select.value = getVolumeSliderMode();
        select.addEventListener('change', () => {
            setVolumeSliderMode(select.value);
            refreshOptionsPopupState();
        });
        select.addEventListener('keydown', (event) => event.stopPropagation());
        section.append(label, select);
        return section;
    }

    function createPlacementSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.id = 'tm-volume-options-placement-section';
        section.appendChild(createOptionsSectionLabel('Placement'));

        const segment = createOptionsSegment([
            createOptionsRadio(
                'tm-volume-options-placement-native',
                'Native spot',
                getReplaceNativePlacement() === 'native',
                () => setReplaceNativePlacement('native')
            ),
            createOptionsRadio(
                'tm-volume-options-placement-custom',
                'Custom spot',
                getReplaceNativePlacement() === 'custom',
                () => setReplaceNativePlacement('custom')
            )
        ]);
        segment.setAttribute('role', 'radiogroup');
        segment.setAttribute('aria-label', 'Position when replacing native');
        section.appendChild(segment);
        section.appendChild(createBehaviorRows());
        return section;
    }

    function createBehaviorRows() {
        const list = document.createElement('div');
        list.className = 'tm-volume-options-checklist';
        list.appendChild(createOptionsCheckboxRow(
            'tm-volume-options-location-video',
            'Show on video',
            isSliderOnVideo(),
            (next) => setSliderLocation(next ? 'video' : 'controls')
        ));
        list.appendChild(createOptionsCheckboxRow(
            'tm-volume-options-always-expanded',
            'Always expanded',
            isAlwaysExpandedEnabled(),
            (next) => setAlwaysExpandedEnabled(next)
        ));
        return list;
    }

    function createVolumeStepSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-step-setting';
        section.id = 'tm-volume-options-step-section';
        section.appendChild(createOptionsSectionLabel('Adjustment step'));

        const segment = createOptionsSegment(VOLUME_STEPS.map((step) =>
            createOptionsRadio(
                `tm-volume-options-step-${step}`,
                `${step}%`,
                getVolumeStep() === step,
                () => setVolumeStep(step)
            )
        ));
        segment.setAttribute('role', 'radiogroup');
        segment.setAttribute('aria-label', 'Volume adjustment step');
        section.appendChild(segment);
        return section;
    }

    function createNormalizationSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.appendChild(createOptionsSectionLabel('Audio'));
        const list = document.createElement('div');
        list.className = 'tm-volume-options-checklist';
        const toggle = createOptionsCheckboxRow(
            'tm-volume-options-normalization', 'Auto-normalize volume',
            isNormalizationEnabled(), setNormalizationEnabled
        );
        toggle.setAttribute('aria-describedby', 'tm-volume-options-normalization-help tm-volume-options-normalization-status');
        list.appendChild(toggle);
        section.appendChild(list);
        const help = document.createElement('p');
        help.id = 'tm-volume-options-normalization-help';
        help.className = 'tm-volume-options-help';
        help.textContent = 'Keeps sources closer in loudness. Your slider sets the listening level. Increases are limited to normal player volume.';
        help.hidden = true;
        toggle.title = help.textContent;
        section.appendChild(help);
        const feedback = document.createElement('div');
        feedback.className = 'tm-volume-options-normalization-feedback';
        const status = document.createElement('p');
        status.id = 'tm-volume-options-normalization-status';
        status.className = 'tm-volume-options-help';
        status.setAttribute('role', 'status');
        status.textContent = getNormalizationStatus();
        feedback.appendChild(status);
        const details = document.createElement('p');
        details.id = 'tm-volume-options-normalization-details';
        details.className = 'tm-volume-options-help';
        details.setAttribute('aria-live', 'off');
        details.textContent = getNormalizationDetails();
        details.hidden = !details.textContent;
        feedback.appendChild(details);
        section.appendChild(feedback);
        section.appendChild(createVolumeStepSection());
        return section;
    }

    function createAppearanceSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.id = 'tm-volume-options-appearance-section';
        section.appendChild(createOptionsSectionLabel('Icon style'));

        const segment = createOptionsSegment([
            createOptionsRadio(
                'tm-volume-options-appearance-new',
                'New',
                getVolumeAppearance() === 'new',
                () => setVolumeAppearance('new')
            ),
            createOptionsRadio(
                'tm-volume-options-appearance-classic',
                'Classic',
                getVolumeAppearance() === 'classic',
                () => setVolumeAppearance('classic')
            )
        ]);
        segment.setAttribute('role', 'radiogroup');
        segment.setAttribute('aria-label', 'Icon style');
        section.appendChild(segment);
        return section;
    }

    function createRangeSettingRow({
        label,
        ariaLabel,
        resetAriaLabel,
        min,
        max,
        step,
        fallback,
        getValue,
        setValue,
        resetValue,
        onPreviewStart,
        onPreviewEnd,
        getFillPercent = (value) => value
    }) {
        const row = document.createElement('div');
        row.className = 'tm-volume-options-opacity-row';

        const labelGroup = document.createElement('div');
        labelGroup.className = 'tm-volume-options-opacity-label-group';

        const name = document.createElement('span');
        name.className = 'tm-volume-options-opacity-name';
        name.textContent = label;

        const valueEl = document.createElement('span');
        valueEl.className = 'tm-volume-options-opacity-value';

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'tm-volume-options-opacity-reset';
        resetBtn.appendChild(createOptionsButtonLabel('Reset'));
        resetBtn.setAttribute('aria-label', resetAriaLabel);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        slider.className = 'tm-volume-options-opacity-slider';
        slider.setAttribute('aria-label', ariaLabel);

        const refresh = () => {
            const pct = getValue();
            slider.value = String(pct);
            slider.style.setProperty('--tm-opacity-fill', `${getFillPercent(pct)}%`);
            valueEl.textContent = `${Math.round(pct)}%`;
        };
        refresh();

        ['click', 'mousedown', 'pointerdown', 'keydown'].forEach((type) => {
            slider.addEventListener(type, (event) => event.stopPropagation());
        });
        const hasPreview = !!(onPreviewStart || onPreviewEnd);
        if (hasPreview) {
            const startPreview = (event) => {
                if (activePreview?.slider === slider || (event.type === 'mousedown' && event.button !== 0)) {
                    return;
                }
                stopOptionsPreview();
                // Starting a preview may recreate the overlay and dispose its old state.
                onPreviewStart?.();
                activePreview = { slider, onEnd: onPreviewEnd };
                for (const target of previewTargets) {
                    for (const type of previewEndEvents) {
                        target.addEventListener(type, stopOptionsPreview, true);
                    }
                }
            };
            for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
                slider.addEventListener(type, startPreview);
            }
            slider.addEventListener('blur', (event) => {
                if (activePreview?.slider !== slider || document.getElementById(OPTIONS_POPUP_ID)?.contains(event.relatedTarget)) {
                    return;
                }
                stopOptionsPreview();
            });
        }
        slider.addEventListener('input', () => {
            const value = Number(slider.value);
            const pct = Number.isFinite(value) ? value : fallback;
            slider.style.setProperty('--tm-opacity-fill', `${getFillPercent(pct)}%`);
            valueEl.textContent = `${Math.round(pct)}%`;
            setValue(pct);
        });
        resetBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            resetValue();
            refresh();
        });

        labelGroup.appendChild(name);
        labelGroup.appendChild(valueEl);

        const controls = document.createElement('div');
        controls.className = 'tm-volume-options-opacity-controls';
        controls.appendChild(slider);
        controls.appendChild(resetBtn);

        row.appendChild(labelGroup);
        row.appendChild(controls);
        return row;
    }

    function createOpacityRow(label, focused) {
        return createRangeSettingRow({
            label,
            ariaLabel: `${label} opacity`,
            resetAriaLabel: `Reset ${label} opacity`,
            min: 0,
            max: 100,
            step: 1,
            fallback: 0,
            getValue: () => getSavedOverlayOpacityPercent(focused),
            setValue: (pct) => setSavedOverlayOpacityPercent(focused, pct),
            resetValue: () => resetSavedOverlayOpacityPercent(focused),
            onPreviewStart: () => beginOpacitySliderPreview?.(focused),
            onPreviewEnd: endOpacitySliderPreview
        });
    }

    function createOpacitySection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.id = 'tm-volume-options-opacity-section';
        section.appendChild(createOptionsSectionLabel('On-video opacity'));
        section.appendChild(createOpacityRow('Idle', false));
        section.appendChild(createOpacityRow('Active', true));
        return section;
    }

    function createSizeSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.id = 'tm-volume-options-size-section';
        section.appendChild(createOptionsSectionLabel('On-video size'));

        section.appendChild(createRangeSettingRow({
            label: 'Size',
            ariaLabel: 'On-video size',
            resetAriaLabel: 'Reset on-video size',
            min: 100,
            max: 200,
            step: 5,
            fallback: 100,
            getValue: getSavedOverlaySizePercent,
            setValue: setSavedOverlaySizePercent,
            resetValue: resetSavedOverlaySizePercent,
            getFillPercent: (pct) => pct - 100
        }));
        return section;
    }

    function createThicknessSection() {
        const section = document.createElement('div');
        section.className = 'tm-volume-options-section';
        section.id = 'tm-volume-options-thickness-section';
        section.appendChild(createOptionsSectionLabel('Bar thickness'));

        section.appendChild(createRangeSettingRow({
            label: 'Thickness',
            ariaLabel: 'Bar thickness',
            resetAriaLabel: 'Reset bar thickness',
            min: 25,
            max: 125,
            step: 5,
            fallback: 75,
            getValue: getSavedSliderThicknessPercent,
            setValue: setSavedSliderThicknessPercent,
            resetValue: resetSavedSliderThicknessPercent,
            onPreviewStart: beginThicknessSliderPreview,
            onPreviewEnd: endThicknessSliderPreview,
            getFillPercent: (pct) => pct - 25
        }));
        return section;
    }

    function buildOptionsPopup() {
        stopOptionsPreview();
        const popup = document.createElement('div');
        popup.id = OPTIONS_POPUP_ID;
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-label', 'Volume Slider Options');
        popup.toggleAttribute('hidden', true);

        const header = document.createElement('div');
        header.className = 'tm-volume-options-header';
        const title = document.createElement('div');
        title.className = 'tm-volume-options-title';
        title.textContent = 'Volume Slider Options';
        header.appendChild(title);

        const body = document.createElement('div');
        body.className = 'tm-volume-options-body';
        const tabList = document.createElement('div');
        tabList.className = 'tm-volume-options-tabs';
        tabList.setAttribute('role', 'tablist');
        tabList.setAttribute('aria-label', 'Volume settings');
        const panels = ['general', 'appearance'].map((name) => {
            const panel = document.createElement('div');
            panel.id = `tm-volume-options-panel-${name}`;
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', `tm-volume-options-tab-${name}`);
            body.appendChild(panel);
            return panel;
        });
        const tabs = panels.map((panel, index) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.id = panel.getAttribute('aria-labelledby');
            tab.className = 'tm-volume-options-tab';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', panel.id);
            tab.appendChild(createOptionsButtonLabel(index ? 'Appearance' : 'General'));
            tab.addEventListener('click', () => selectTab(index));
            tab.addEventListener('keydown', (event) => {
                let next;
                if (event.key === 'ArrowLeft') next = (index + panels.length - 1) % panels.length;
                else if (event.key === 'ArrowRight') next = (index + 1) % panels.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = panels.length - 1;
                else return;
                event.preventDefault();
                event.stopPropagation();
                selectTab(next);
                tabs[next].focus();
            });
            tabList.appendChild(tab);
            return tab;
        });
        function selectTab(index) {
            stopOptionsPreview();
            tabs.forEach((tab, i) => {
                tab.setAttribute('aria-selected', i === index ? 'true' : 'false');
                tab.tabIndex = i === index ? 0 : -1;
                panels[i].hidden = i !== index;
            });
            body.scrollTop = 0;
        }
        panels[0].append(createNormalizationSection(), createPlacementSection());
        panels[1].append(createAppearanceSection(), createThicknessSection(), createSizeSection(), createOpacitySection());
        const hint = document.createElement('p');
        hint.className = 'tm-volume-options-help tm-volume-options-appearance-hint';
        hint.append('To adjust size and opacity,', document.createElement('br'), 'enable “Show on video” in General.');
        panels[1].appendChild(hint);
        selectTab(0);

        popup.appendChild(header);
        popup.appendChild(createModeSection());
        popup.appendChild(tabList);
        popup.appendChild(body);
        popup.addEventListener('click', (event) => event.stopPropagation());
        return popup;
    }

  return { buildOptionsPopup, syncOptionsPopupState, syncNormalizationStatus, stopOptionsPreview };
}
