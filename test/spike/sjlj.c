#include <stdio.h>
#include <setjmp.h>

static jmp_buf buf;

static void raiser(int depth) {
  if (depth == 0) longjmp(buf, 42);
  raiser(depth - 1);
}

int main(void) {
  if (setjmp(buf) == 0) {
    printf("try\n");
    raiser(5);
    printf("unreachable\n");
  } else {
    printf("caught\n");
  }
  printf("done\n");
  return 0;
}
