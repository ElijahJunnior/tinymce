/**
 * Copyright (c) Tiny Technologies, Inc. All rights reserved.
 * Licensed under the LGPL or a commercial license.
 * For LGPL see License.txt in the project root for license information.
 * For commercial licenses see https://www.tiny.cloud/
 */

import { Arr, Fun, Merger, Obj, Optional, Strings, Type } from '@ephox/katamari';
import { PlatformDetection } from '@ephox/sand';

import Editor from '../api/Editor';
import { NormalizedEditorOptions, RawEditorOptions, ToolbarMode } from '../api/OptionTypes';
import Tools from '../api/util/Tools';

interface SectionResult {
  sections: () => Record<string, Partial<RawEditorOptions>>;
  options: () => RawEditorOptions;
}

const sectionResult = (sections: Record<string, Partial<RawEditorOptions>>, settings: RawEditorOptions): SectionResult => ({
  sections: Fun.constant(sections),
  options: Fun.constant(settings)
});

const deviceDetection = PlatformDetection.detect().deviceType;
const isTouch = deviceDetection.isTouch();
const isPhone = deviceDetection.isPhone();
const isTablet = deviceDetection.isTablet();
const defaultTouchOptions: RawEditorOptions = {
  table_grid: false,          // Table grid relies on hover, which isn't available so use the dialog instead
  resize: false              // Editor resize doesn't work on touch devices at this stage
};

const normalizePlugins = (plugins: string | string[]) => {
  const pluginNames = Type.isArray(plugins) ? plugins.join(' ') : plugins;
  const trimmedPlugins = Arr.map(Type.isString(pluginNames) ? pluginNames.split(' ') : [ ], Strings.trim);
  return Arr.filter(trimmedPlugins, (item) => {
    return item.length > 0;
  });
};

const extractSections = (keys: string[], options: RawEditorOptions) => {
  const result = Obj.bifilter(options, (value, key) => {
    return Arr.contains(keys, key);
  });

  return sectionResult(result.t, result.f);
};

const getSection = (sectionResult: SectionResult, name: string, defaults: Partial<RawEditorOptions> = { }) => {
  const sections = sectionResult.sections();
  const sectionOptions = Obj.get(sections, name).getOr({});
  return Tools.extend({}, defaults, sectionOptions);
};

const hasSection = (sectionResult: SectionResult, name: string) => {
  return Obj.has(sectionResult.sections(), name);
};

const getSectionConfig = (sectionResult: SectionResult, name: string) => {
  return hasSection(sectionResult, name) ? sectionResult.sections()[name] : {};
};

const getToolbarMode = (options: RawEditorOptions, defaultVal: ToolbarMode) =>
  // If toolbar_mode is unset by the user, fall back to:
  Obj.get(options, 'toolbar_mode').getOr(defaultVal);

// TODO: TINY-8235 (TINY-8234) Move more default options to where they are registered
const getDefaultOptions = (options: RawEditorOptions, isTouch: boolean): RawEditorOptions => {
  const baseDefaults: RawEditorOptions = {
    toolbar_mode: getToolbarMode(options, 'floating')
  };

  return {
    ...baseDefaults,
    ...isTouch ? defaultTouchOptions : { }
  };
};

const getDefaultMobileOptions = (mobileOptions: RawEditorOptions, isPhone: boolean): RawEditorOptions => {
  const defaultMobileOptions: RawEditorOptions = {
    resize: false,               // Editor resize doesn't make sense on mobile
    toolbar_mode: getToolbarMode(mobileOptions, 'scrolling'),   // Use the default side-scrolling toolbar for tablets/phones
    toolbar_sticky: false        // Only enable sticky toolbar on desktop by default
  };

  const defaultPhoneOptions: RawEditorOptions = {
    menubar: false               // Phones don't have a lot of screen space, so disable the menubar
  };

  return {
    ...defaultTouchOptions,
    ...defaultMobileOptions,
    ...isPhone ? defaultPhoneOptions : { }
  };
};

const getExternalPlugins = (overrideOptions: RawEditorOptions, options: RawEditorOptions) => {
  const userDefinedExternalPlugins = options.external_plugins ?? { };
  if (overrideOptions && overrideOptions.external_plugins) {
    return Tools.extend({}, overrideOptions.external_plugins, userDefinedExternalPlugins);
  } else {
    return userDefinedExternalPlugins;
  }
};

const combinePlugins = (forcedPlugins: string[], plugins: string[]): string[] => {
  return [].concat(normalizePlugins(forcedPlugins)).concat(normalizePlugins(plugins));
};

const getPlatformPlugins = (isMobileDevice: boolean, sectionResult: SectionResult, desktopPlugins: string[], mobilePlugins: string[]): string[] => {
  // is a mobile device with any mobile options
  if (isMobileDevice && hasSection(sectionResult, 'mobile')) {
    return mobilePlugins;
  // is desktop
  } else {
    return desktopPlugins;
  }
};

const processPlugins = (isMobileDevice: boolean, sectionResult: SectionResult, defaultOverrideOptions: RawEditorOptions, options: RawEditorOptions & { external_plugins: Record<string, string> }): NormalizedEditorOptions => {
  const forcedPlugins = normalizePlugins(defaultOverrideOptions.forced_plugins);
  const desktopPlugins = normalizePlugins(options.plugins);

  const mobileConfig = getSectionConfig(sectionResult, 'mobile');
  const mobilePlugins = mobileConfig.plugins ? normalizePlugins(mobileConfig.plugins) : desktopPlugins;

  const platformPlugins = getPlatformPlugins(isMobileDevice, sectionResult, desktopPlugins, mobilePlugins);

  const combinedPlugins = combinePlugins(forcedPlugins, platformPlugins);

  return Tools.extend(options, {
    forced_plugins: forcedPlugins,
    plugins: combinedPlugins.join(' ')
  });
};

const isOnMobile = (isMobileDevice: boolean, sectionResult: SectionResult) => {
  return isMobileDevice && hasSection(sectionResult, 'mobile');
};

const combineOptions = (isMobileDevice: boolean, isPhone: boolean, defaultOptions: RawEditorOptions, defaultOverrideOptions: RawEditorOptions, options: RawEditorOptions): NormalizedEditorOptions => {
  // Use mobile mode by default on phones, so patch in the default mobile options
  const defaultDeviceOptions = isMobileDevice ? { mobile: getDefaultMobileOptions(options.mobile || {}, isPhone) } : { };
  const sectionResult = extractSections([ 'mobile' ], Merger.deepMerge(defaultDeviceOptions, options));

  const extendedOptions = Tools.extend(
    // Default options
    defaultOptions,

    // tinymce.overrideOptions options
    defaultOverrideOptions,

    // User options
    sectionResult.options(),

    // Sections
    isOnMobile(isMobileDevice, sectionResult) ? getSection(sectionResult, 'mobile') : { },

    // Forced options
    {
      external_plugins: getExternalPlugins(defaultOverrideOptions, sectionResult.options())
    }
  );

  return processPlugins(isMobileDevice, sectionResult, defaultOverrideOptions, extendedOptions);
};

const normalizeOptions = (defaultOverrideOptions: RawEditorOptions, options: RawEditorOptions): NormalizedEditorOptions => {
  const defaultOptions = getDefaultOptions(options, isTouch);
  return combineOptions(isPhone || isTablet, isPhone, defaultOptions, defaultOverrideOptions, options);
};

const getFiltered = <K extends keyof NormalizedEditorOptions> (predicate: (x: any) => boolean, editor: Editor, name: K): Optional<NormalizedEditorOptions[K]> => Optional.from(editor.settings[name]).filter(predicate);

const getParamObject = (value: string) => {
  let output = {};

  if (typeof value === 'string') {
    Arr.each(value.indexOf('=') > 0 ? value.split(/[;,](?![^=;,]*(?:[;,]|$))/) : value.split(','), (val: string) => {
      const arr = val.split('=');

      if (arr.length > 1) {
        output[Tools.trim(arr[0])] = Tools.trim(arr[1]);
      } else {
        output[Tools.trim(arr[0])] = Tools.trim(arr[0]);
      }
    });
  } else {
    output = value;
  }

  return output;
};

const isArrayOf = (p: (a: any) => boolean) => (a: any) => Type.isArray(a) && Arr.forall(a, p);

// TODO: TINY-8236 (TINY-8234) Remove this once all settings are converted
const getParam = (editor: Editor, name: string, defaultVal?: any, type?: string) => {
  const value = name in editor.settings ? editor.settings[name] : defaultVal;

  if (type === 'hash') {
    return getParamObject(value);
  } else if (type === 'string') {
    return getFiltered(Type.isString, editor, name).getOr(defaultVal);
  } else if (type === 'number') {
    return getFiltered(Type.isNumber, editor, name).getOr(defaultVal);
  } else if (type === 'boolean') {
    return getFiltered(Type.isBoolean, editor, name).getOr(defaultVal);
  } else if (type === 'object') {
    return getFiltered(Type.isObject, editor, name).getOr(defaultVal);
  } else if (type === 'array') {
    return getFiltered(Type.isArray, editor, name).getOr(defaultVal);
  } else if (type === 'string[]') {
    return getFiltered(isArrayOf(Type.isString), editor, name).getOr(defaultVal);
  } else if (type === 'function') {
    return getFiltered(Type.isFunction, editor, name).getOr(defaultVal);
  } else {
    return value;
  }
};

export { normalizeOptions, getParam, combineOptions, getDefaultOptions, getDefaultMobileOptions };