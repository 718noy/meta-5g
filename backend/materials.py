"""재질별 전파 감쇠 모델.

3GPP TR 38.901 Table 7.4.3-1 의 재질 투과 손실(주파수 의존)을 기반으로,
공칭 두께로 나눠 dB/m 감쇠율로 변환한다. 전파가 장애물 내부를 통과한
실제 경로 길이에 비례해 손실을 적용하기 위함.

  - 콘크리트:  L = 5 + 4·f[GHz]      (공칭 20cm)
  - 표준 유리:  L = 2 + 0.2·f[GHz]    (공칭 1.5cm)
  - 목재:      L = 4.85 + 0.12·f[GHz] (공칭 4cm)
  - 금속:      사실상 차폐 (매우 큰 감쇠율, 총손실 상한으로 제어)
"""

# 장애물 하나당 적용할 최대 손실(dB) — 수치 폭주 방지
MAX_LOSS_PER_OBSTACLE_DB = 150.0


def attenuation_db_per_m(material: str, freq_mhz: float) -> float:
    """주파수(MHz)에 따른 재질 감쇠율 [dB/m]."""
    f_ghz = freq_mhz / 1000.0
    if material == "concrete":
        return (5.0 + 4.0 * f_ghz) / 0.20
    if material == "glass":
        return (2.0 + 0.2 * f_ghz) / 0.015
    if material == "wood":
        return (4.85 + 0.12 * f_ghz) / 0.04
    if material == "metal":
        return 5000.0
    # 알 수 없는 재질은 목재 수준으로 취급
    return (4.85 + 0.12 * f_ghz) / 0.04
