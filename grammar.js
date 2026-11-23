// Taken from the expr man page
const PREC = {
  unary: 150, // - + ~ !
  exp: 140, // **
  muldiv: 130, // * / %
  addsub: 120, // + -
  shift: 110, // << >>
  compare: 100, // > < >= <=
  equal_bool: 90, // == !=
  equal_string: 80, // eq ne
  contain: 70, // in ni
  and_bit: 60, // &
  xor_bit: 50, // ^
  or_bit: 40, // |
  and_logical: 30, // &&
  or_logical: 20, // ||
  ternary: 10, // x ? y : z
};

const interleaved1 = (rule, delim) => seq(rule, repeat(seq(delim, rule)));

const scriptBody = $ => choice(
  seq(
    repeat1(seq(optional($._command), $._terminator)),
    optional($._command),
  ),
  $._command,
);

const binaryExpr = (left, right) => choice(
  prec.right(PREC.exp, seq(left, '**', right)),
  prec.left(PREC.muldiv, seq(left, choice('/', '*', '%'), right)),
  prec.left(PREC.addsub, seq(left, choice('+', '-'), right)),
  prec.left(PREC.shift, seq(left, choice('<<', '>>'), right)),
  prec.left(PREC.compare, seq(left, choice('>', '<', '>=', '<='), right)),
  prec.left(PREC.equal_bool, seq(left, choice('==', '!='), right)),
  prec.left(PREC.equal_string, seq(left, choice('eq', 'ne'), right)),
  prec.left(PREC.contain, seq(left, choice('in', 'ni'), right)),
  prec.left(PREC.and_bit, seq(left, '&', right)),
  prec.left(PREC.xor_bit, seq(left, '^', right)),
  prec.left(PREC.or_bit, seq(left, '|', right)),
  prec.left(PREC.and_logical, seq(left, '&&', right)),
  prec.left(PREC.or_logical, seq(left, '||', right)),
);

module.exports = grammar({
  name: 'tcl',

  word: $ => $.simple_word,

  externals: $ => [
    $._concat,
    $._immediate,
  ],

  conflicts: $ => [
    [$._concat_part, $.argument],
  ],

  inline: $ => [
    $._builtin,
    $._braced_star,
    $._terminator,
  ],

  extras: $ => [
    /\s+/,
    token(prec(1, /\\\r?\n/)),
  ],

  rules: {
    source_file: $ => optional(scriptBody($)),

    _terminator: _ => choice('\n', ';'),

    // An unpaired backslash continues a comment across LF or CRLF; pairs do not.
    // Allow a final backslash when the comment ends at EOF.
    comment: _ => /#([^\\\n]|\\([^\n]|\r?\n))*\\?/,

    _builtin: $ => choice(
      $._conditional,
      $.global,
      $.namespace,
      $.procedure,
      $.set,
      $.try,
      $.foreach,
      $.expr_cmd,
      $.while,
      $.catch,
      $.regexp,
      $.regsub,
    ),

    // regexp ?switches? exp string ?matchVar? ?subMatchVar subMatchVar ...?
    regexp: $ => seq(
      'regexp',
      $._regexp_word,
      $._regexp_word,
      repeat($._regexp_word),
    ),

    _regexp_word: $ => seq(
      optional($.unpack),
      choice($.braced_word_simple, $._concat_word),
    ),

    regsub: $ => seq(
      'regsub',
      repeat(seq(
        optional($.unpack),
        choice($.braced_word_simple, $._concat_word),
      )),
    ),

    while: $ => seq('while', $.expr, $._word),

    expr_cmd: $ => seq('expr', choice($.expr, alias($.unbraced_expr, $.expr))),

    unbraced_expr: $ => choice(
      alias($.unbraced_binop_expr, $.binop_expr),
      alias($.unbraced_ternary_expr, $.ternary_expr),
    ),

    _unbraced_operand: $ => choice(
      $._expr_atom_no_brace,
      alias($.unbraced_unary_expr, $.unary_expr),
      alias($.unbraced_ternary_expr, $.ternary_expr),
      seq('(', $._unbraced_operand, ')'),
      alias($.unbraced_binop_expr, $.binop_expr),
    ),

    unbraced_unary_expr: $ => prec.left(PREC.unary, seq(
      choice('-', '+', '~', '!'), $._unbraced_operand,
    )),

    unbraced_binop_expr: $ => binaryExpr(
      $._unbraced_operand, choice($._unbraced_operand, $.braced_word_simple),
    ),

    unbraced_ternary_expr: $ => prec.right(PREC.ternary, seq(
      $._unbraced_operand,
      '?', choice($._unbraced_operand, $.braced_word_simple),
      ':', choice($._unbraced_operand, $.braced_word_simple),
    )),

    foreach: $ => seq(
      'foreach',
      repeat1(seq($.arguments, $._word_simple)),
      $._word,
    ),

    global: $ => seq('global', repeat($._concat_word)),

    namespace: $ => seq('namespace', $.word_list),

    try: $ => seq(
      'try',
      $._word,
      repeat(choice(
        seq('on', choice('error', $._word_simple), $.arguments, $._word),
        seq('trap', $._word_simple, optional($.arguments), $._word),
      )),
      optional($.finally),
    ),

    finally: $=> seq('finally', $._word),

    _command: $ => choice(
      $._builtin,
      $.comment,
      $.command,
    ),

    command: $ => seq(
      field('name', seq(optional($.unpack), choice($.braced_word_simple, $._concat_word))),
      optional(field('arguments', $.word_list)),
    ),

    word_list: $ => repeat1($._word),

    // Prefer expansion when an adjacent word follows the shared {*} token.
    unpack: $ => prec(1, seq('{*}', $._immediate)),

    _word: $ => seq(
      optional($.unpack),
      choice(
        $.braced_word,
        $._concat_word,
      ),
    ),

    // Only braces at the start of a word suppress substitutions.
    _word_simple: $ => seq(optional($.unpack), $._word_simple_content),

    _imm_word_sep: $ => prec(-1, alias(
      choice(token.immediate(':'), token.immediate('('), token.immediate(')')),
      $.simple_word,
    )),

    _word_simple_content: $ => choice(
      $.braced_word_simple,
      seq(
        choice($._word_simple_part, $.quoted_word, alias('(', $.simple_word), alias(')', $.simple_word)),
        repeat(choice(
          seq($._concat, choice(
            $._word_simple_part,
            alias('"', $.simple_word),
            $._unquoted_braces,
          )),
          $._imm_word_sep,
        )),
      ),
    ),

    _word_simple_part: $ => choice(
      $.escaped_character,
      $.command_substitution,
      prec.right(seq($.simple_word, optional($.array_index))),
      alias('!', $.simple_word),
      $.variable_substitution,
    ),

    _word_with_substitutions: $ => interleaved1(choice(
      $._word_simple_part,
      alias('"', $.simple_word),
      $._unquoted_braces,
    ), $._concat),

    _unquoted_braces: $ => seq('{', repeat($._word_with_substitutions), '}'),

    _concat_part: $ => choice(
      $.escaped_character,
      $.command_substitution,
      prec.right(seq($.simple_word, optional($.array_index))),
      alias('!', $.simple_word),
      $.variable_substitution,
    ),

    _concat_word: $ => seq(
      choice($._concat_part, $.quoted_word, alias('(', $.simple_word), alias(')', $.simple_word)),
      repeat(choice(
        seq($._concat, choice($._concat_part, alias('"', $.simple_word))),
        $._imm_word_sep,
      )),
    ),

    _ns_delim: _ => token.immediate(prec(1, /::+/)),

    _ident_imm: _ => token.immediate(/[a-zA-Z0-9_]+/),
    _ident: _ => /[a-zA-Z0-9_]+/,

    _id_immediate: $ => seq(
      optional($._ns_delim), $._ident_imm,
      repeat(seq($._ns_delim, $._ident_imm)),
    ),

    id: $ => seq(
      choice(seq('::', $._ident_imm), $._ident),
      repeat(seq($._ns_delim, $._ident_imm)),
    ),

    array_index: $ => prec(1, seq(
      token.immediate('('),
      optional($._word_with_substitutions),
      repeat(seq(alias(':', $.simple_word), optional($._word_with_substitutions))),
      ')',
    )),

    anon_array_index: $ => seq(
      '(',
      optional($._word_with_substitutions),
      repeat(seq(alias(':', $.simple_word), optional($._word_with_substitutions))),
      ')',
    ),

    variable_substitution: $ => choice(
      prec.right(seq('$', alias($._id_immediate, $.id), optional($.array_index))),
      seq('$', $.array_index),
      seq('$', '{', /[^}]+/, '}'),
    ),

    braced_word: $ => choice(
      $._braced_star,
      seq('{', optional(scriptBody($)), '}'),
    ),

    // Braces nest, but quotes and substitutions are literal here.
    braced_word_simple: $ => choice(
      $._braced_star,
      seq('{', repeat(choice(
        $._braced_word_content,
        $.braced_word_simple,
      )), '}'),
    ),

    // Share the check so a following delimiter can still end a literal.
    _braced_star: $ => seq('{*}', optional($._immediate)),

    _braced_word_content: _ => token(/([^{}\\]|\\(.|\r|\n))+/),

    _set_id: $ => prec.right(2, seq(alias($.simple_word, $.id), optional($.array_index))),

    set: $ => seq(
      'set',
      choice(
        field('name', $.braced_word_simple),
        seq(
          $._set_id,
          repeat(choice(
            seq($._concat, choice($._concat_part, alias('"', $.simple_word))),
            $._imm_word_sep,
          )),
        ),
        seq(
          alias($.anon_array_index, $.array_index),
          repeat(choice(
            seq($._concat, choice($._concat_part, alias('"', $.simple_word))),
            $._imm_word_sep,
          )),
        ),
        seq(
          choice($.variable_substitution, $.command_substitution, $.quoted_word,
            alias('!', $.id)),
          repeat(choice(
            seq($._concat, choice($._concat_part, alias('"', $.simple_word))),
            $._imm_word_sep,
          )),
        ),
      ),
      optional($._word_simple),
    ),


    procedure: $ => seq(
      'proc',
      field('name', $._word),
      field('arguments', $.arguments),
      field('body', $._word),
    ),

    _argument_word: $ => choice($.simple_word, $.quoted_word, $.braced_word),

    argument: $ => choice(
      field('name', $.simple_word),
      seq(
        '{',
        field('name', $.simple_word),
        optional(field('default', $._argument_word)),
        '}',
      ),
    ),

    arguments: $ => choice(
      seq('{', repeat($.argument), '}'),
      $._concat_word,
    ),

    number: $ => token(prec(1, /[+-]?(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?)/)),
    _boolean: $ => token(choice(
      '1', '0',
      /[Tt][Rr][Uu][Ee]/,
      /[Ff][Aa][Ll][Ss][Ee]/,
    )),

    _expr_atom_no_brace: $ => choice(
      // As a numeric value, either integer or floating-point.
      $.number,

      // As a boolean value, using any form understood by string is boolean.
      $._boolean,

      // As a mathematical function whose arguments have any of the above
      // forms for operands, such as sin($x). See MATH FUNCTIONS below for a
      // discussion of how mathematical functions are handled.
      seq($.simple_word, '(', optional(interleaved1($._expr, ',')), ')'),

      // As a Tcl command enclosed in brackets. The command will be executed
      // and its result will be used as the operand.
      $.command_substitution,

      // As a string enclosed in double-quotes. The expression parser will
      // perform backslash, variable, and command substitutions on the
      // information between the quotes, and use the resulting value as the
      // operand
      $.quoted_word,

      // As a Tcl variable, using standard $ notation. The variable's value
      // will be used as the operand.
      $.variable_substitution,
    ),

    _expr: $ => choice(
      $.unary_expr,
      $.binop_expr,
      $.ternary_expr,
      $.escaped_character,
      seq('(', $._expr, ')'),
      $._expr_atom_no_brace,

      // As a string enclosed in braces. The characters between the open
      // brace and matching close brace will be used as the operand without
      // any substitutions.
      $.braced_word_simple,
    ),

    expr: $ => choice(
      seq('{', $._expr, '}'),
      seq('(', $._unbraced_operand, ')'),
      $._expr_atom_no_brace,
      alias($.unbraced_unary_expr, $.unary_expr),
    ),

    unary_expr: $ => prec.left(PREC.unary, seq(choice('-', '+', '~', '!'), $._expr)),

    binop_expr: $ => choice(
      prec.right(PREC.exp, seq($._expr, '**', $._expr)),
      prec.left(PREC.muldiv, seq($._expr, choice('/', '*', '%'), $._expr)),
      prec.left(PREC.addsub, seq($._expr, choice('+', '-'), $._expr)),
      prec.left(PREC.shift, seq($._expr, choice('<<', '>>'), $._expr)),
      prec.left(PREC.compare, seq($._expr, choice('>', '<', '>=', '<='), $._expr)),
      prec.left(PREC.equal_bool, seq($._expr, choice('==', '!='), $._expr)),
      prec.left(PREC.equal_string, seq($._expr, choice('eq', 'ne'), $._expr)),
      prec.left(PREC.contain, seq($._expr, choice('in', 'ni'), $._expr)),
      prec.left(PREC.and_bit, seq($._expr, '&', $._expr)),
      prec.left(PREC.xor_bit, seq($._expr, '^', $._expr)),
      prec.left(PREC.or_bit, seq($._expr, '|', $._expr)),
      prec.left(PREC.and_logical, seq($._expr, '&&', $._expr)),
      prec.left(PREC.or_logical, seq($._expr, '||', $._expr)),
    ),

    ternary_expr: $ => prec.right(PREC.ternary, seq($._expr, '?', $._expr, ':', $._expr)),

    elseif: $ => seq(
      'elseif',
      field('condition', $.expr),
      optional('then'),
      field('consequence', $._word),
    ),

    else: $ => seq(
      'else',
      field('consequence', $._word),
    ),

    implicit_else: $ => field('consequence', $._word),

    if: $ => seq(
      'if',
      field('condition', $.expr),
      optional('then'),
      field('consequence', $._word),
      repeat(field('alternative', $.elseif)),
      optional(field('alternative', choice($.else, alias($.implicit_else, $.else)))),
    ),

    _conditional: $ => choice(
      $.if,
      $.else,
      $.elseif,
    ),

    // catch script ?resultVarName? ?optionsVarName?
    catch: $ => seq(
      'catch',
      $._word,
      optional($._concat_word),
      optional($._concat_word),
    ),

    quoted_word: $ => seq(
      '"',
      repeat(choice(
        $.variable_substitution,
        $._quoted_word_content,
        $.command_substitution,
        $.escaped_character,
        '$',
        ']',
      )),
      '"',
    ),

    escaped_character: _ => /\\./,

    _quoted_word_content: _ => token(prec(-1, /[^$\\\[\]"]+/)),

    command_substitution: $ => seq('[', optional(scriptBody($)), ']'),

    simple_word: _ => /[^!$\s\\\[\]{}();"]+/,
  },

});
