// Not anything inside double quotes
// Not anything inside single quotes
// Not anything inside url()
// Any digit followed by px
// !singlequotes|!doublequotes|!url()|pixelunit
function getUnitRegexp(unit) {
  return new RegExp(
    "\"[^\"]+\"|'[^']+'|url\\([^\\)]+\\)|(\\d*\\.?\\d+)" + unit,
    "g"
  );
}
export const filterPropList = {
  exact: (list) => list.filter((m) => m.match(/^[^\*\!]+$/)),
  contain: (list) =>
    list
      .filter((m) => m.match(/^\*.+\*$/))
      .map((m) => m.substr(1, m.length - 2)),
  endWith: (list) =>
    list.filter((m) => m.match(/^\*[^\*]+$/)).map((m) => m.substr(1)),
  startWith: (list) =>
    list
      .filter((m) => m.match(/^[^\*\!]+\*$/))
      .map((m) => m.substr(0, m.length - 1)),
  notExact: (list) =>
    list.filter((m) => m.match(/^\![^\*].*$/)).map((m) => m.substr(1)),
  notContain: (list) =>
    list
      .filter((m) => m.match(/^\!\*.+\*$/))
      .map((m) => m.substr(2, m.length - 3)),
  notEndWith: (list) =>
    list.filter((m) => m.match(/^\!\*[^\*]+$/)).map((m) => m.substr(2)),
  notStartWith: (list) =>
    list
      .filter((m) => m.match(/^\![^\*]+\*$/))
      .map((m) => m.substr(1, m.length - 2)),
};

function createPropListMatcher(propList) {
  var hasWild = propList.indexOf("*") > -1;
  var matchAll = hasWild && propList.length === 1;
  var lists = {
    exact: filterPropList.exact(propList),
    contain: filterPropList.contain(propList),
    startWith: filterPropList.startWith(propList),
    endWith: filterPropList.endWith(propList),
    notExact: filterPropList.notExact(propList),
    notContain: filterPropList.notContain(propList),
    notStartWith: filterPropList.notStartWith(propList),
    notEndWith: filterPropList.notEndWith(propList),
  };
  return function (prop) {
    if (matchAll) return true;
    return (
      (hasWild ||
        lists.exact.indexOf(prop) > -1 ||
        lists.contain.some((m) => prop.indexOf(m) > -1) ||
        lists.startWith.some((m) => prop.indexOf(m) === 0) ||
        lists.endWith.some(
          (m) => prop.indexOf(m) === prop.length - m.length
        )) &&
      !(
        lists.notExact.indexOf(prop) > -1 ||
        lists.notContain.some((m) => prop.indexOf(m) > -1) ||
        lists.notStartWith.some((m) => prop.indexOf(m) === 0) ||
        lists.notEndWith.some((m) => prop.indexOf(m) === prop.length - m.length)
      )
    );
  };
}

const PLUGIN_DEFAULT_OPTIONS = {
  unitToConvert: "px",
  viewportWidth: 320,
  viewportHeight: 568, // not now used; TODO: need for different units and math for different properties
  unitPrecision: 5,
  viewportUnit: "vw",
  fontViewportUnit: "vw", // vmin is more suitable.
  selectorBlackList: [],
  propList: ["*"],
  minPixelValue: 1,
  mediaQuery: false,
  replace: true,
  landscape: false,
  landscapeUnit: "vw",
  landscapeWidth: 568,
};

function toString(target) {
  return Object.prototype.toString.call(target);
}

function postcssPX2VW(options) {
  var opts = Object.assign({}, PLUGIN_DEFAULT_OPTIONS, options);
  var pxRegex = getUnitRegexp(opts.unitToConvert);
  var satisfyPropList = createPropListMatcher(opts.propList);
  var landscapeRules = [];

  function exclude(opts, file) {
    if (opts.exclude && file) {
      if (Array.isArray(opts.exclude))
        return opts.exclude.some((rule) => isExclude(rule, file));
      return isExclude(opts.exclude, file);
    }
    return false;
  }

  function Once(root, { AtRule }) {
    root.walkRules(function (rule) {
      var file = rule.source && rule.source.input.file;

      if (exclude(opts, file)) return;
      if (blacklistedSelector(opts.selectorBlackList, rule.selector)) return;

      if (opts.landscape && !rule.parent.params) {
        var landscapeRule = rule.clone().removeAll();

        rule.walkDecls(function (decl) {
          if (decl.value.indexOf(opts.unitToConvert) === -1) return;
          if (!satisfyPropList(decl.prop)) return;

          landscapeRule.append(
            decl.clone({
              value: decl.value.replace(
                pxRegex,
                createPxReplace(opts, opts.landscapeUnit, opts.landscapeWidth)
              ),
            })
          );
        });

        if (landscapeRule.nodes.length > 0) {
          landscapeRules.push(landscapeRule);
        }
      }

      if (!validateParams(rule.parent.params, opts.mediaQuery)) return;

      rule.walkDecls(function (decl, i) {
        if (decl.value.indexOf(opts.unitToConvert) === -1) return;
        if (!satisfyPropList(decl.prop)) return;

        var unit;
        var size;
        var params = rule.parent.params;

        if (opts.landscape && params && params.indexOf("landscape") !== -1) {
          unit = opts.landscapeUnit;
          size = opts.landscapeWidth;
        } else {
          unit = getUnit(decl.prop, opts);
          size = opts.viewportWidth;
        }

        var value = decl.value.replace(
          pxRegex,
          createPxReplace(opts, unit, size)
        );

        if (declarationExists(decl.parent, decl.prop, value)) return;

        if (opts.replace) {
          decl.value = value;
        } else {
          decl.parent.insertAfter(i, decl.clone({ value: value }));
        }
      });
    });

    if (landscapeRules.length > 0) {
      var media = new AtRule({
        params: "(orientation: landscape)",
        name: "media",
      });

      landscapeRules.forEach((rule) => media.append(rule));
      root.append(media);
    }
  }

  return {
    postcssPlugin: "px2vw",
    Once,
  };
}

function getUnit(prop, opts) {
  return prop.indexOf("font") === -1
    ? opts.viewportUnit
    : opts.fontViewportUnit;
}

function createPxReplace(opts, viewportUnit, viewportSize) {
  return function (m, $1) {
    if (!$1) return m;
    var pixels = parseFloat($1);
    if (pixels <= opts.minPixelValue) return m;
    var parsedVal = toFixed((pixels / viewportSize) * 100, opts.unitPrecision);
    return parsedVal === 0 ? "0" : parsedVal + viewportUnit;
  };
}

function toFixed(number, precision) {
  var multiplier = Math.pow(10, precision + 1),
    wholeNumber = Math.floor(number * multiplier);
  return (Math.round(wholeNumber / 10) * 10) / multiplier;
}

function blacklistedSelector(blacklist, selector) {
  if (typeof selector !== "string") return;
  return blacklist.some(function (regex) {
    if (typeof regex === "string") return selector.indexOf(regex) !== -1;
    return selector.match(regex);
  });
}

function isExclude(reg, file) {
  if (!isRegExp(reg)) throw new Error("options.exclude should be RegExp.");
  return file.match(reg) !== null;
}
function declarationExists(decls, prop, value) {
  return decls.some(function (decl) {
    return decl.prop === prop && decl.value === value;
  });
}

function validateParams(params, mediaQuery) {
  return !params || (params && mediaQuery);
}

function isRegExp(target) {
  return toString(target) == "[object RegExp]";
}
postcssPX2VW.postcss = true;
export default postcssPX2VW;
