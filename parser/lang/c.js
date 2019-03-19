const i_common = require('../common');
const i_extractor = require('../extractor');
const i_decorator = require('../decorator');

const c_extract_feature = {
   '"': [extract_string],
   '\'': [extract_char],
   '/': [extract_line_comment, extract_multiline_comment]
};

function extract_string(env) {
   return i_extractor.extract_string(env, '"', '"', '\\');
}

function extract_char(env) {
   return i_extractor.extract_string(env, '\'', '\'', '\\');
}

function extract_line_comment(env) {
   return i_extractor.extract_comment(env, '//', '\n');
}

function extract_multiline_comment(env) {
   return i_extractor.extract_comment(env, '/*', '*/');
}

const c_keywords = [
   // ref:
   // - https://en.cppreference.com/w/c/keyword
   'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double',
   'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'int', 'long', 'register',
   'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef',
   'union', 'unsigned', 'void', 'volatile', 'while',
   /* C99 */ '_Bool', '_Complex', '_Imaginary', 'inline', 'restrict', '_Pragma',
   /* C11 */ '_Alignas', '_Alignof', '_Atomic', '_Generic', '_Noreturn', '_Static_assert',
   '_Thread_local',
   /* C extension */ 'asm', 'fortran',
   '#if', '#ifdef', '#ifndef', '#else', '#elif', '#endif', '#pragma', '#error',
   '#define', '#undef', '#line', 'defined', '#include',
];

const c_combinations = [
   '++', '--', '+=', '-=', '*=', '/=', '%=', '==',
   '!=', '>=', '<=', '->', '&&', '||', '<<', '>>',
   '&=', '|=', '^=', '<<=', '>>=',
   // XXX: currently do not support "#     ifdef TEST ..."
   ['#', 'include'],
   ['#', 'if'], ['#', 'ifdef'], ['#', 'ifndef'],
   ['#', 'else'], ['#', 'elif'], ['#', 'endif'],
   ['#', 'pragma'], ['#', 'error'], ['#', 'define'],
   ['#', 'undef'], ['#', 'line'],
];

const c_decorate_precompile_feature = {
   '#include': [decorate_include],
   '#if': [decorate_bracket_region],
   '#ifdef': [decorate_bracket_region],
   '#ifndef': [decorate_bracket_region],
   '#elif': [decorate_bracket_region],
   '#else': [decorate_bracket_region],
   '#endif': [decorate_bracket_region],
   '#pragma': [decorate_precompile],
   '#error': [decorate_precompile],
   '#define': [decorate_precompile],
   '#undef': [decorate_precompile],
   '#line': [decorate_precompile],
   '{': [decorate_bracket],
   '[': [decorate_bracket],
   '(': [decorate_bracket],
   '}': [decorate_bracket],
   ']': [decorate_bracket],
   ')': [decorate_bracket],
   ';': [decorate_defable],
   '\\\n': [decorate_combline],
};

const c_decorate_feature = {
   '#include': [skip_precompile],
   '#if': [skip_precompile],
   '#ifdef': [skip_precompile],
   '#ifndef': [skip_precompile],
   '#elif': [skip_precompile],
   '#else': [skip_precompile],
   '#endif': [skip_precompile],
   '#pragma': [skip_precompile],
   '#error': [skip_precompile],
   '#define': [skip_precompile],
   '#undef': [skip_precompile],
   '#line': [skip_precompile],
   '{': [
      decorate_function, decorate_struct,
      decorate_enum, decorate_union
   ],
   ';': [decorate_function],
};

function decorate_combline(env) {
   let token = env.tokens[env.cursor];
   token._token = token.token;
   token.token = '';
   return 1;
}

const return_type_prefix = ['struct', 'enum', 'union'];
const keyword_block = ['if', 'for', 'while', 'switch'];
function decorate_function(env) {
   let st = env.cursor;
   let token = env.tokens[st];
   // int main() {}
   // int main() ;
   let ed = token.endIndex || env.cursor;
   if (!token.defable) {
      return 0;
   }
   let parameter = [];
   st = i_common.search_prev_skip_spacen(env.tokens, st - 1);
   token = env.tokens[st];
   if (token.token !== ')') return 0;
   parameter.push(st);
   st = i_common.search_prev(env.tokens, st - 1, (x) => x.endIndex !== st + 1);
   parameter.unshift(st);
   token = env.tokens[st];
   if (!token) return 0;
   st = i_common.search_prev_skip_spacen(env.tokens, st - 1);
   token = env.tokens[st];
   if (!token) return 0;
   if (keyword_block.indexOf(token.token) >= 0) {
      // if/for/while/switch (...) {...}
      return 0;
   }
   let return_type = st;
   if (token.token === ')') {
      // return function pointer
      parameter = [];
      return_type = i_common.search_prev(env.tokens, st - 1, (x) => x.endIndex !== st);
      st = i_common.search_prev_skip_spacen(env.tokens, st - 1);
      token = env.tokens[st];
      if (!token) return 0;
      if (token.token !== ')') return 0;
      parameter.push(st);
      st = i_common.search_prev(env.tokens, st - 1, (x) => x.endIndex !== st + 1);
      parameter.unshift(st);
      st = i_common.search_prev_skip_spacen(env.tokens, st - 1);
      token = env.tokens[st];
   }
   let name = [st, st + 1];
   // search for heading type, e.g. int, struct name {int a;}**
   while (true) {
      return_type = i_common.search_prev_skip_spacen(env.tokens, return_type - 1);
      token = env.tokens[return_type];
      if (!token) break;
      if (token.token === '*') continue;
      if (token.token === '}') {
         return_type = i_common.search_prev(
            env.tokens, return_type - 1, (x) => x.endIndex !== return_type + 1
         );
         return_type = i_common.search_prev_skip_spacen(env.tokens, return_type - 1);
         token = env.tokens[return_type];
         if (!token) break;
      }
      //      m0() {}      m1() {}
      // void m0() {} void m1() {}
      if (token.token === ')') {
         break;
      }
      // name
      if (return_type_prefix.indexOf(token.token) < 0) {
         st = return_type;
         return_type = i_common.search_prev_skip_spacen(env.tokens, return_type - 1);
         token = env.tokens[return_type];
         if (token && token.endIndex && return_type_prefix.indexOf(token.token) >= 0) {
            st = return_type;
         }
      } else {
         st = return_type;
      }
      // TODO: search for function attribute, e.g. extern, static
      break;
   }
   token = env.tokens[name[0]];
   token.startIndex = st;
   token.endIndex = ed;
   token.parameter = parameter;
   token.name = name;
   token.tag = i_common.TAG_FUNCTION;
   token = env.tokens[env.cursor];
   return 1;
}

function decorate_type(env, type) {
   let st = env.cursor;
   let token = env.tokens[st];
   let ed = token.endIndex;
   let name = null;
   st = i_common.search_prev_skip_spacen(env.tokens, st - 1);
   token = env.tokens[st];
   if (!token) return 0;
   if (token.token !== type) {
      name = [st, st + 1];
      st = i_common.search_prev_skip_spacen(env.tokens, st - 1);
   }
   token = env.tokens[st];
   if (!token) return 0;
   if (token.token !== type) {
      return 0;
   }
   token.startIndex = st;
   token.endIndex = ed;
   token.tag = i_common.TAG_CLASS;
   if (name) token.name = name;
   return 1;
}

function decorate_struct(env) {
   return decorate_type(env, 'struct');
}

function decorate_enum(env) {
   return decorate_type(env, 'enum');
}

function decorate_union(env) {
   return decorate_type(env, 'union');
}

function skip_precompile(env) {
   let token = env.tokens[env.cursor];
   return token.endIndex - token.startIndex;
}

function decorate_include(env) {
   let st = env.cursor, ed = st;
   let start_token = env.tokens[st];
   ed = i_common.search_next(env.tokens, st + 1, (x) => x.tag !== i_common.TAG_STRING && x.token !== '<');
   let token = env.tokens[ed];
   if (!token) return 1;
   start_token.startIndex = st;
   if (token.tag === i_common.TAG_STRING) {
      start_token.name = [ed, ed + 1];
   } else {
      st = ed + 1;
      ed = i_common.search_next(env.tokens, st, (x) => x.token !== '>');
      start_token.name = [st, ed];
   }
   start_token.endIndex = ed + 1;
   return ed - st;
}

function decorate_bracket_region(env) {
   // XXX: currently assume there is no case to separte function definition:
   // cannot process:
   // e.g. int main() {
   // #ifdef A
   //    return 0;
   // }
   // #else
   //    return 1;
   // }
   // #endif
   //
   // can process:
   // e.g. int main() {
   // #ifdef A
   //    return 0;
   // #else
   //    return 1;
   // #endif
   // } 
   let token = env.tokens[env.cursor];
   if (!env.bracket_stack) env.bracket_stack = [];
   if (!env.bracket_stack_snapshot) env.bracket_stack_snapshot = [];
   let snapshot;
   switch (token.token) {
      case '#if': case '#ifdef': case '#ifndef':
         snapshot = env.bracket_stack.slice();
         env.bracket_stack_snapshot.push(snapshot);
         // to gurantee #elif and #else region not overwrite origin token endIndex
         let origin = snapshot.pop();
         let fake = Object.assign({}, origin);
         origin && snapshot.push(fake);
         break;
      case '#elif': case '#else':
         // XXX: cannot match like "#   if", "#   ifdef", "# ifndef"
         env.bracket_stack = env.bracket_stack_snapshot[env.bracket_stack_snapshot.length-1].slice();
         break;
      case '#endif':
         env.bracket_stack_snapshot.pop();
         break;
   }
   return decorate_precompile(env);
}

function decorate_precompile(env) {
   let st = env.cursor;
   let ed = st;
   let token;
   do {
      ed = i_common.search_next(
         env.tokens, ed+1,
         (x) => x.token !== '\n' && x.tag !== i_common.TAG_COMMENT
      );
      token = env.tokens[ed];
      if (!token) break;
      if (token.comment) {
         if (token.comment.charAt(token.comment.length - 1) === '\n') break;
      } else {
         token = env.tokens[ed-1];
         if (!token || token.token !== '\\') break;
      }
   } while (true);
   let start_token = env.tokens[st];
   start_token.startIndex = st;
   start_token.endIndex = ed;
   return ed - st;
}

function decorate_defable(env) {
   let token = env.tokens[env.cursor];
   if (env.bracket_stack && env.bracket_stack.length) return 0;
   token.defable = true;
   return 1;
}

function decorate_bracket(env) {
   if (!env.bracket_stack) {
      env.bracket_stack = [];
   }
   let bracket_token = env.tokens[env.cursor];
   switch (bracket_token.token) {
      case '{':
         if (!env.bracket_stack.length) {
            bracket_token.defable = true;
         }
      case '[': case '(':
         bracket_token.tag = i_common.TAG_BRACKET[bracket_token.token];
         bracket_token.startIndex = env.cursor;
         env.bracket_stack.push(bracket_token);
         break;
      case '}': case ']': case ')':
         bracket_token = env.bracket_stack.pop();
         // TODO: deal with not pairing bracket
         bracket_token.endIndex = env.cursor + 1;
         break;
   }
   return 1;
}

function tokenize(env) {
   env.cursor = 0;
   i_extractor.extract_tokens(env, c_extract_feature);
   return env.tokens;
}

function parse(env) {
   tokenize(env);
   i_extractor.merge_tokens(env, c_combinations);
   env.cursor = 0;
   i_decorator.decorate_scope(env, c_decorate_precompile_feature);
   // TODO: simulate preprocess
   i_decorator.decorate_keywords(env, c_keywords);
   env.cursor = 0;
   i_decorator.decorate_scope(env, c_decorate_feature);
   return env.tokens;
}

module.exports = {
   tokenize: (text) => tokenize({ text }),
   parse: (text) => parse({ text }),
};